
CREATE TYPE public.order_status AS ENUM ('pending','confirmed','preparing','ready','assigned','picked_up','delivered','cancelled','refunded');
CREATE TYPE public.payment_method AS ENUM ('stripe','moncash','natcash','kach');
CREATE TYPE public.payment_status AS ENUM ('pending','awaiting_proof','under_review','paid','failed','refunded');
CREATE TYPE public.delivery_status AS ENUM ('assigned','en_route_pickup','picked_up','en_route_dropoff','delivered','cancelled');

CREATE TABLE public.addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT, address_line TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'Gonaïves',
  notes TEXT, lat NUMERIC, lng NUMERIC,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addresses TO authenticated;
GRANT ALL ON public.addresses TO service_role;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own addresses" ON public.addresses FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_addr_upd BEFORE UPDATE ON public.addresses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL UNIQUE DEFAULT ('NK-' || to_char(now(),'YYMMDD') || '-' || substr(gen_random_uuid()::text,1,6)),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE RESTRICT,
  address_id UUID REFERENCES public.addresses(id),
  delivery_address TEXT NOT NULL,
  delivery_notes TEXT, contact_phone TEXT,
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  service_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'HTG',
  status order_status NOT NULL DEFAULT 'pending',
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orders insert" ON public.orders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_id);
CREATE POLICY "orders update" ON public.orders FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid()));
CREATE TRIGGER trg_orders_upd BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_orders_customer ON public.orders(customer_id);
CREATE INDEX idx_orders_restaurant ON public.orders(restaurant_id);
CREATE INDEX idx_orders_status ON public.orders(status);

CREATE TABLE public.order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  product_name TEXT NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  line_total NUMERIC(10,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
GRANT ALL ON public.order_items TO service_role;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_items via order" ON public.order_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND (
    o.customer_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id AND o.customer_id = auth.uid()));

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'HTG',
  stripe_payment_intent_id TEXT,
  stripe_session_id TEXT,
  transaction_ref TEXT,
  sender_name TEXT, sender_phone TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments read" ON public.payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payments.order_id AND (
    o.customer_id = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
  )));
CREATE POLICY "payments insert" ON public.payments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payments.order_id AND o.customer_id = auth.uid()));
CREATE POLICY "payments admin update" ON public.payments FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER trg_pay_upd BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.payment_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  transaction_ref TEXT, sender_phone TEXT, notes TEXT,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_proofs TO authenticated;
GRANT ALL ON public.payment_proofs TO service_role;
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proofs read" ON public.payment_proofs FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid()
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "proofs insert" ON public.payment_proofs FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE TABLE public.deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  status delivery_status NOT NULL DEFAULT 'assigned',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  driver_notes TEXT,
  fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deliveries TO authenticated;
GRANT ALL ON public.deliveries TO service_role;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deliveries read" ON public.deliveries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = deliveries.driver_id AND d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = deliveries.order_id AND (
      o.customer_id = auth.uid()
      OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
    )));
CREATE POLICY "deliveries admin write" ON public.deliveries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "deliveries driver update" ON public.deliveries FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = deliveries.driver_id AND d.user_id = auth.uid()));
CREATE TRIGGER trg_del_upd BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Orders read policy AFTER deliveries exists
CREATE POLICY "orders read" ON public.orders FOR SELECT TO authenticated
  USING (auth.uid() = customer_id
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = orders.restaurant_id AND r.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
               WHERE d.order_id = orders.id AND dr.user_id = auth.uid()));

CREATE TABLE public.reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  restaurant_rating INT CHECK (restaurant_rating BETWEEN 1 AND 5),
  driver_rating INT CHECK (driver_rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, customer_id)
);
GRANT SELECT ON public.reviews TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews public read" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "reviews insert own" ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());
CREATE POLICY "reviews update own" ON public.reviews FOR UPDATE TO authenticated
  USING (customer_id = auth.uid());

CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif own" ON public.notifications FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX idx_notif_user ON public.notifications(user_id, created_at DESC);

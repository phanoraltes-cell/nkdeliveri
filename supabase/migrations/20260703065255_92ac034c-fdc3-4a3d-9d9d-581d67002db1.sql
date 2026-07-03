-- 1) Restaurants: payout + commission config
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS moncash_number text,
  ADD COLUMN IF NOT EXISTS moncash_account_name text,
  ADD COLUMN IF NOT EXISTS natcash_number text,
  ADD COLUMN IF NOT EXISTS natcash_account_name text,
  ADD COLUMN IF NOT EXISTS payout_mode text NOT NULL DEFAULT 'via_admin',
  ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'per_order',
  ADD COLUMN IF NOT EXISTS commission_rate numeric(6,3) NOT NULL DEFAULT 10.0,
  ADD COLUMN IF NOT EXISTS monthly_commission_amount numeric(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_payout_mode_chk') THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_payout_mode_chk CHECK (payout_mode IN ('direct','via_admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurants_commission_type_chk') THEN
    ALTER TABLE public.restaurants
      ADD CONSTRAINT restaurants_commission_type_chk CHECK (commission_type IN ('per_order','monthly'));
  END IF;
END $$;

-- 2) Drivers: payout numbers + frequency
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS moncash_number text,
  ADD COLUMN IF NOT EXISTS natcash_number text,
  ADD COLUMN IF NOT EXISTS payout_frequency text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS commission_rate numeric(12,2) NOT NULL DEFAULT 100;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_payout_frequency_chk') THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_payout_frequency_chk CHECK (payout_frequency IN ('daily','monthly'));
  END IF;
END $$;

-- 3) Payments: receiver info for manual methods
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS receiver_type text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS receiver_restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS receiver_number text,
  ADD COLUMN IF NOT EXISTS receiver_account_name text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_receiver_type_chk') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_receiver_type_chk CHECK (receiver_type IN ('admin','merchant'));
  END IF;
END $$;

-- 4) Notification triggers on payments status change
CREATE OR REPLACE FUNCTION public.notify_payment_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_customer_title text;
  v_customer_body text;
  v_merchant_title text;
  v_merchant_body text;
  v_owner uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT o.id, o.order_number, o.customer_id, o.restaurant_id, r.owner_id, r.name AS restaurant_name
    INTO v_order
    FROM public.orders o
    JOIN public.restaurants r ON r.id = o.restaurant_id
   WHERE o.id = NEW.order_id;

  IF NOT FOUND THEN RETURN NEW; END IF;
  v_owner := v_order.owner_id;

  IF NEW.status = 'paid' THEN
    v_customer_title := 'Peman ou apwouve';
    v_customer_body := 'Peman kòmand ' || v_order.order_number || ' apwouve. Restoran an ap kòmanse prepare li.';
    v_merchant_title := 'Nouvo kòmand konfime';
    v_merchant_body := 'Peman resevwa pou kòmand ' || v_order.order_number || '.';
  ELSIF NEW.status = 'failed' THEN
    v_customer_title := 'Peman ou rejte';
    v_customer_body := 'Peman kòmand ' || v_order.order_number || ' rejte. ' ||
      COALESCE('Rezon: ' || NEW.review_notes, 'Tanpri voye yon nouvo prèv.');
    v_merchant_title := 'Peman rejte';
    v_merchant_body := 'Admin rejte peman pou kòmand ' || v_order.order_number || '.';
  ELSIF NEW.status = 'under_review' THEN
    v_customer_title := 'Prèv peman resevwa';
    v_customer_body := 'Prèv peman kòmand ' || v_order.order_number || ' ap tann verifikasyon admin.';
    v_merchant_title := NULL;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_order.customer_id,
    'payment_' || NEW.status,
    v_customer_title,
    v_customer_body,
    jsonb_build_object('order_id', v_order.id, 'payment_id', NEW.id, 'order_number', v_order.order_number)
  );

  IF v_owner IS NOT NULL AND v_merchant_title IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_owner,
      'payment_' || NEW.status,
      v_merchant_title,
      v_merchant_body,
      jsonb_build_object('order_id', v_order.id, 'payment_id', NEW.id, 'order_number', v_order.order_number)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_payment_status ON public.payments;
CREATE TRIGGER trg_notify_payment_status
AFTER UPDATE OF status ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.notify_payment_status_change();

-- 5) Allow authenticated users to mark their own notifications read
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'Users update own notifications'
  ) THEN
    CREATE POLICY "Users update own notifications" ON public.notifications
      FOR UPDATE TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
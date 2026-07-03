-- Add pickup/dropoff coordinates on orders/restaurants (nullable) and driver live location on deliveries
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_lat numeric,
  ADD COLUMN IF NOT EXISTS delivery_lng numeric;

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS driver_lat numeric,
  ADD COLUMN IF NOT EXISTS driver_lng numeric,
  ADD COLUMN IF NOT EXISTS driver_heading numeric,
  ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;

-- Allow assigned driver to update their own delivery row (location + status timestamps)
DROP POLICY IF EXISTS "Driver can update own delivery" ON public.deliveries;
CREATE POLICY "Driver can update own delivery"
ON public.deliveries FOR UPDATE
TO authenticated
USING (
  driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
)
WITH CHECK (
  driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
);

-- Allow customer to read the delivery for their own order (map tracking)
DROP POLICY IF EXISTS "Customer can view own order delivery" ON public.deliveries;
CREATE POLICY "Customer can view own order delivery"
ON public.deliveries FOR SELECT
TO authenticated
USING (
  order_id IN (SELECT id FROM public.orders WHERE customer_id = auth.uid())
  OR driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

-- Enable Realtime on deliveries and orders
ALTER TABLE public.deliveries REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='deliveries'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.deliveries';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='orders'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.orders';
  END IF;
END $$;
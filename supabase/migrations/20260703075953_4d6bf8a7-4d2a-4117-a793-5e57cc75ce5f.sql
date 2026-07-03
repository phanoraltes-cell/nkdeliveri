
-- 1) New table
CREATE TABLE public.restaurant_payout_details (
  restaurant_id uuid PRIMARY KEY REFERENCES public.restaurants(id) ON DELETE CASCADE,
  payout_mode text NOT NULL DEFAULT 'via_admin',
  moncash_number text,
  moncash_account_name text,
  natcash_number text,
  natcash_account_name text,
  commission_type text,
  commission_rate numeric,
  monthly_commission_amount numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_payout_details TO authenticated;
GRANT ALL ON public.restaurant_payout_details TO service_role;

ALTER TABLE public.restaurant_payout_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view own payout details"
  ON public.restaurant_payout_details FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid()));

CREATE POLICY "Admins can view all payout details"
  ON public.restaurant_payout_details FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Owner can upsert own payout details"
  ON public.restaurant_payout_details FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid()));

CREATE POLICY "Owner can update own payout details"
  ON public.restaurant_payout_details FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = restaurant_id AND r.owner_id = auth.uid()));

CREATE POLICY "Admins can manage payout details"
  ON public.restaurant_payout_details FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_restaurant_payout_details_updated
BEFORE UPDATE ON public.restaurant_payout_details
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Migrate existing data
INSERT INTO public.restaurant_payout_details (
  restaurant_id, payout_mode, moncash_number, moncash_account_name,
  natcash_number, natcash_account_name, commission_type, commission_rate, monthly_commission_amount
)
SELECT id,
  COALESCE(payout_mode, 'via_admin'),
  moncash_number, moncash_account_name,
  natcash_number, natcash_account_name,
  commission_type, commission_rate, monthly_commission_amount
FROM public.restaurants
ON CONFLICT (restaurant_id) DO NOTHING;

-- 3) Checkout-facing limited view (signed-in customers only, no commission columns)
CREATE OR REPLACE VIEW public.restaurant_payout_public
WITH (security_invoker = true) AS
SELECT
  restaurant_id,
  payout_mode,
  moncash_number,
  moncash_account_name,
  natcash_number,
  natcash_account_name
FROM public.restaurant_payout_details;

REVOKE ALL ON public.restaurant_payout_public FROM PUBLIC, anon;
GRANT SELECT ON public.restaurant_payout_public TO authenticated;

-- Allow any signed-in user (customer at checkout) to read the limited payout row.
CREATE POLICY "Authenticated can read payout for checkout"
  ON public.restaurant_payout_details FOR SELECT TO authenticated
  USING (true);
-- Note: This overlaps with owner/admin SELECT policies; the view exposes only
-- non-commission columns. Direct queries to the table still return all columns
-- to authenticated users, so protect commission fields at the app layer by
-- always reading from restaurant_payout_public unless owner/admin.

-- Actually to guarantee commission fields stay private, drop the broad policy
-- above and instead expose the checkout data via a SECURITY DEFINER function.
DROP POLICY "Authenticated can read payout for checkout" ON public.restaurant_payout_details;
DROP VIEW public.restaurant_payout_public;

CREATE OR REPLACE FUNCTION public.get_restaurant_payout_public(_restaurant_id uuid)
RETURNS TABLE (
  restaurant_id uuid,
  payout_mode text,
  moncash_number text,
  moncash_account_name text,
  natcash_number text,
  natcash_account_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT restaurant_id, payout_mode, moncash_number, moncash_account_name,
         natcash_number, natcash_account_name
  FROM public.restaurant_payout_details
  WHERE restaurant_id = _restaurant_id;
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_payout_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_payout_public(uuid) TO authenticated;

-- 4) Drop sensitive columns from public restaurants table
ALTER TABLE public.restaurants
  DROP COLUMN IF EXISTS moncash_number,
  DROP COLUMN IF EXISTS moncash_account_name,
  DROP COLUMN IF EXISTS natcash_number,
  DROP COLUMN IF EXISTS natcash_account_name,
  DROP COLUMN IF EXISTS payout_mode,
  DROP COLUMN IF EXISTS commission_type,
  DROP COLUMN IF EXISTS commission_rate,
  DROP COLUMN IF EXISTS monthly_commission_amount;

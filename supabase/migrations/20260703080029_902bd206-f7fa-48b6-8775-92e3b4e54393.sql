
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.get_restaurant_payout_public(_restaurant_id uuid)
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

REVOKE ALL ON FUNCTION private.get_restaurant_payout_public(uuid) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.get_restaurant_payout_public(uuid);

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
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT * FROM private.get_restaurant_payout_public(_restaurant_id);
$$;

REVOKE ALL ON FUNCTION public.get_restaurant_payout_public(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_restaurant_payout_public(uuid) TO authenticated;

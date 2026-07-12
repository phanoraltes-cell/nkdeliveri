-- Drivers only had moncash_number/natcash_number (phone-number-style), no
-- account-holder-name field — unlike their restaurant-side twin
-- (restaurant_payout_details.moncash_account_name/natcash_account_name).
-- Bring drivers to parity so admin can identify whose MonCash/NatCash
-- account a commission payout is going to, not just the number.
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS moncash_account_name text,
  ADD COLUMN IF NOT EXISTS natcash_account_name text;

-- Drop the old 4-arg overload before recreating with the 2 new params —
-- otherwise both signatures coexist as separate overloads in Postgres,
-- leaving an orphaned one that no client calls (same overload hazard the
-- 20260709070000_fix_menu_overload_and_commission_admin.sql migration
-- already had to clean up once for a different function).
DROP FUNCTION IF EXISTS public.update_driver_payout_secure(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.update_driver_payout_secure(
  _driver_id uuid,
  _moncash_number text,
  _moncash_account_name text,
  _natcash_number text,
  _natcash_account_name text,
  _payout_frequency text
)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.drivers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _payout_frequency NOT IN ('daily', 'monthly') THEN
    RAISE EXCEPTION 'Invalid payout frequency';
  END IF;

  UPDATE public.drivers SET
    moncash_number = _moncash_number,
    moncash_account_name = _moncash_account_name,
    natcash_number = _natcash_number,
    natcash_account_name = _natcash_account_name,
    payout_frequency = _payout_frequency
  WHERE id = _driver_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_driver_payout_secure(uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_payout_secure(uuid, text, text, text, text, text) TO authenticated;

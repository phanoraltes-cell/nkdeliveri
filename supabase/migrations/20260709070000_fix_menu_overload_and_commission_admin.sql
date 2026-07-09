-- ---------------------------------------------------------------------------
-- 1) THE root cause of "meni pa mache": 20260706151929 added a `_stock_quantity
--    integer DEFAULT NULL` parameter to create_product_secure/update_product_secure
--    via CREATE OR REPLACE FUNCTION. Postgres treats a different argument list
--    as a brand new overload, not a replacement — so the original 7-arg
--    versions (from 20260704120500) were never actually removed, they just sat
--    alongside the new 8-arg ones. Any client call whose JSON body omits
--    _stock_quantity (the common case — most dishes don't set a stock limit,
--    and JSON.stringify drops undefined keys) now matches BOTH overloads
--    equally well, which PostgREST/Postgres refuses to resolve:
--      ERROR 42725: function ... is not unique
--      HINT: Could not choose a best candidate function.
--    Reproduced live against the linked project and confirmed this is exactly
--    why zero restaurants have ever successfully added a menu item. Dropping
--    the superseded 7-arg overloads leaves one unambiguous function per name.
DROP FUNCTION IF EXISTS public.create_product_secure(uuid, uuid, text, text, numeric, text, text);
DROP FUNCTION IF EXISTS public.update_product_secure(uuid, text, text, numeric, text, text, uuid, boolean);

-- ---------------------------------------------------------------------------
-- 2) restaurant_payout_details' admin policies only checked has_role(...,
--    'admin'), unlike every other admin-gated policy/RPC in this project
--    (matches the same gap already fixed for storage in 20260706150555). A
--    super_admin-only account would be silently blocked from viewing or
--    managing any restaurant's commission/payout config.
DROP POLICY IF EXISTS "Admins can view all payout details" ON public.restaurant_payout_details;
CREATE POLICY "Admins can view all payout details" ON public.restaurant_payout_details FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Admins can manage payout details" ON public.restaurant_payout_details;
CREATE POLICY "Admins can manage payout details" ON public.restaurant_payout_details FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------------
-- 3) THE root cause of "komisyon pa mache": the restaurant payouts page has
--    always told owners "Sèl yon administratè NK ka chanje komisyon platfòm
--    nan" (only an NK admin can change this), but no RPC, no UI, and no other
--    code path anywhere in this project ever lets an admin actually do that —
--    confirmed by grepping the whole app for commission-setting logic and
--    finding only the trigger that BLOCKS self-service changes
--    (protect_restaurant_commission), never one that allows an admin change.
--    Every restaurant is permanently stuck at the 10%/per_order default with
--    zero path to override it. Add the missing admin-side RPC, matching the
--    validation style of update_restaurant_payout_secure.
CREATE OR REPLACE FUNCTION public.update_restaurant_commission_secure(
  _restaurant_id uuid,
  _commission_type text,
  _commission_rate numeric,
  _monthly_commission_amount numeric
)
RETURNS public.restaurant_payout_details
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.restaurant_payout_details;
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _commission_type NOT IN ('per_order', 'monthly') THEN
    RAISE EXCEPTION 'Invalid commission type';
  END IF;
  IF _commission_rate IS NULL OR _commission_rate < 0 OR _commission_rate > 100 THEN
    RAISE EXCEPTION 'Commission rate must be between 0 and 100';
  END IF;
  IF _monthly_commission_amount IS NULL OR _monthly_commission_amount < 0 THEN
    RAISE EXCEPTION 'Monthly commission amount must be zero or more';
  END IF;

  INSERT INTO public.restaurant_payout_details (restaurant_id, commission_type, commission_rate, monthly_commission_amount)
  VALUES (_restaurant_id, _commission_type, _commission_rate, _monthly_commission_amount)
  ON CONFLICT (restaurant_id) DO UPDATE SET
    commission_type = excluded.commission_type,
    commission_rate = excluded.commission_rate,
    monthly_commission_amount = excluded.monthly_commission_amount,
    updated_at = now()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_restaurant_commission_secure(uuid, text, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_restaurant_commission_secure(uuid, text, numeric, numeric) TO authenticated;

-- Admin-facing list: every restaurant with its current commission config
-- (LEFT JOIN since most rows have no restaurant_payout_details row yet).
CREATE OR REPLACE FUNCTION public.get_restaurants_admin()
RETURNS TABLE (
  id uuid,
  name text,
  status public.restaurant_status,
  cuisine text,
  created_at timestamptz,
  commission_type text,
  commission_rate numeric,
  monthly_commission_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.name, r.status, r.cuisine, r.created_at,
    COALESCE(d.commission_type, 'per_order'),
    COALESCE(d.commission_rate, 10),
    COALESCE(d.monthly_commission_amount, 0)
  FROM public.restaurants r
  LEFT JOIN public.restaurant_payout_details d ON d.restaurant_id = r.id
  ORDER BY r.created_at DESC;
END;
$$;
REVOKE ALL ON FUNCTION public.get_restaurants_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurants_admin() TO authenticated;

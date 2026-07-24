-- Read side of the partial-coverage fix (20260722130000_...): a commission
-- can now be linked to several payouts (payout_commissions is no longer
-- 1:1 per commission), so the old single LEFT JOIN payout_commissions/
-- payouts would fan out and duplicate a commission row per contributing
-- payout. Replaced with a LATERAL aggregate: sum of covered_amount across
-- every linking payout, and the most recently linking payout used to
-- derive a single displayable status once fully covered.
--
-- New derived status 'partially_paid': shown whenever a commission has
-- been linked to at least one payout but its total covered_amount hasn't
-- reached net_amount yet -- regardless of what the covering payout's own
-- status is (a commission that's 2/3 paid isn't usefully described as
-- "disputed" just because the partial payout that touched it later got
-- disputed). Only once fully covered does the real payout status
-- (paid/confirmed/disputed/resolved) take over, exactly as before.
--
-- Return shape changes (new covered_amount column) -- CREATE OR REPLACE
-- cannot do this, DROP FUNCTION IF EXISTS required first (docs/MIGRATIONS.md).

DROP FUNCTION IF EXISTS public.get_restaurant_commissions_secure(uuid, text, date, date, text, text, int, int);

CREATE FUNCTION public.get_restaurant_commissions_secure(
  _restaurant_id uuid,
  _search text DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _status text DEFAULT NULL,
  _sort text DEFAULT 'date_desc',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, order_id uuid, order_number text, order_date timestamptz, contact_phone text,
  gross_amount numeric, commission_rate numeric, commission_amount numeric, net_amount numeric,
  covered_amount numeric, entry_type text, commission_status text, payout_id uuid, created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')
    OR private.is_restaurant_manager(_restaurant_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      cl.id, cl.order_id, o.order_number, o.created_at AS order_date, o.contact_phone,
      cl.gross_amount, cl.commission_rate, cl.commission_amount, cl.net_amount,
      COALESCE(cov.total_covered, 0) AS covered_amount,
      cl.entry_type::text AS entry_type,
      CASE
        WHEN cl.entry_type = 'reversal' THEN 'reversed'
        WHEN COALESCE(cov.total_covered, 0) = 0 THEN 'available'
        WHEN cov.total_covered < cl.net_amount THEN 'partially_paid'
        ELSE p.status::text
      END AS commission_status,
      cov.latest_payout_id AS payout_id, cl.created_at
    FROM public.commission_ledger cl
    LEFT JOIN public.orders o ON o.id = cl.order_id
    LEFT JOIN LATERAL (
      SELECT sum(pc.covered_amount) AS total_covered,
        (SELECT pc2.payout_id FROM public.payout_commissions pc2
         WHERE pc2.commission_ledger_id = cl.id ORDER BY pc2.created_at DESC LIMIT 1) AS latest_payout_id
      FROM public.payout_commissions pc WHERE pc.commission_ledger_id = cl.id
    ) cov ON true
    LEFT JOIN public.payouts p ON p.id = cov.latest_payout_id
    WHERE cl.restaurant_id = _restaurant_id
  )
  SELECT b.*, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.order_number ILIKE '%' || _search || '%')
    AND (_from IS NULL OR b.created_at::date >= _from)
    AND (_to IS NULL OR b.created_at::date <= _to)
    AND (_status IS NULL OR b.commission_status = _status)
  ORDER BY
    CASE WHEN _sort = 'date_asc' THEN b.created_at END ASC NULLS LAST,
    CASE WHEN _sort = 'amount_desc' THEN b.net_amount END DESC NULLS LAST,
    CASE WHEN _sort = 'amount_asc' THEN b.net_amount END ASC NULLS LAST,
    b.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_restaurant_commissions_secure(uuid, text, date, date, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_commissions_secure(uuid, text, date, date, text, text, int, int) TO authenticated;

DROP FUNCTION IF EXISTS public.get_driver_commissions_secure(uuid, text, date, date, text, text, int, int);

CREATE FUNCTION public.get_driver_commissions_secure(
  _driver_id uuid,
  _search text DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _status text DEFAULT NULL,
  _sort text DEFAULT 'date_desc',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid, order_id uuid, order_number text, order_date timestamptz, contact_phone text,
  gross_amount numeric, commission_rate numeric, commission_amount numeric, net_amount numeric,
  covered_amount numeric, entry_type text, commission_status text, payout_id uuid, created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = _driver_id AND d.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      cl.id, cl.order_id, o.order_number, o.created_at AS order_date, o.contact_phone,
      cl.gross_amount, cl.commission_rate, cl.commission_amount, cl.net_amount,
      COALESCE(cov.total_covered, 0) AS covered_amount,
      cl.entry_type::text AS entry_type,
      CASE
        WHEN cl.entry_type = 'reversal' THEN 'reversed'
        WHEN COALESCE(cov.total_covered, 0) = 0 THEN 'available'
        WHEN cov.total_covered < cl.net_amount THEN 'partially_paid'
        ELSE p.status::text
      END AS commission_status,
      cov.latest_payout_id AS payout_id, cl.created_at
    FROM public.commission_ledger cl
    LEFT JOIN public.orders o ON o.id = cl.order_id
    LEFT JOIN LATERAL (
      SELECT sum(pc.covered_amount) AS total_covered,
        (SELECT pc2.payout_id FROM public.payout_commissions pc2
         WHERE pc2.commission_ledger_id = cl.id ORDER BY pc2.created_at DESC LIMIT 1) AS latest_payout_id
      FROM public.payout_commissions pc WHERE pc.commission_ledger_id = cl.id
    ) cov ON true
    LEFT JOIN public.payouts p ON p.id = cov.latest_payout_id
    WHERE cl.driver_id = _driver_id
  )
  SELECT b.*, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.order_number ILIKE '%' || _search || '%')
    AND (_from IS NULL OR b.created_at::date >= _from)
    AND (_to IS NULL OR b.created_at::date <= _to)
    AND (_status IS NULL OR b.commission_status = _status)
  ORDER BY
    CASE WHEN _sort = 'date_asc' THEN b.created_at END ASC NULLS LAST,
    CASE WHEN _sort = 'amount_desc' THEN b.net_amount END DESC NULLS LAST,
    CASE WHEN _sort = 'amount_asc' THEN b.net_amount END ASC NULLS LAST,
    b.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_driver_commissions_secure(uuid, text, date, date, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_commissions_secure(uuid, text, date, date, text, text, int, int) TO authenticated;

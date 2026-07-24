-- Performance phase 3: get_restaurant_commissions_secure/
-- get_driver_commissions_secure each looked up payout_commissions TWICE
-- per commission row -- once to sum(covered_amount), once more in a
-- separate correlated subquery to find the most recently linking
-- payout_id via ORDER BY created_at DESC LIMIT 1. Both scans were already
-- correlated/filtered by commission_ledger_id (unlike phases 1-2's bug),
-- so this was never the unbounded-full-table issue -- just twice the
-- necessary lookups against the same (now indexed, see
-- 20260722150000_...) rows.
--
-- Merged into a single pass: array_agg(payout_id ORDER BY created_at DESC)
-- alongside sum(covered_amount) in the same aggregate, then take the
-- array's first element for the "latest" payout_id. This is a standard
-- single-scan idiom for "an aggregate plus the value associated with the
-- min/max of another column" -- one read of payout_commissions per
-- commission row instead of two.
--
-- Identical result for every case, including the empty case: aggregating
-- zero matching rows makes both sum(...) and array_agg(...) come back
-- NULL (never an empty array) in a GROUP-less aggregate, so
-- latest_payout_id stays NULL exactly as before when a commission has
-- never been linked to any payout.
--
-- Return shape is unchanged from 20260722130100 (same columns, same
-- names/types) -- CREATE OR REPLACE in place, no DROP needed.

CREATE OR REPLACE FUNCTION public.get_restaurant_commissions_secure(
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
      SELECT
        sum(pc.covered_amount) AS total_covered,
        (array_agg(pc.payout_id ORDER BY pc.created_at DESC))[1] AS latest_payout_id
      FROM public.payout_commissions pc
      WHERE pc.commission_ledger_id = cl.id
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

CREATE OR REPLACE FUNCTION public.get_driver_commissions_secure(
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
      SELECT
        sum(pc.covered_amount) AS total_covered,
        (array_agg(pc.payout_id ORDER BY pc.created_at DESC))[1] AS latest_payout_id
      FROM public.payout_commissions pc
      WHERE pc.commission_ledger_id = cl.id
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

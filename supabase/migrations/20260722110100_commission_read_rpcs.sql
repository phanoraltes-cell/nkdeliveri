-- Paginated/filterable/sortable commission history for a single restaurant
-- or driver — powers both the new "Mes Komisyon" pages (called with the
-- caller's own beneficiary id) and the admin beneficiary detail profile
-- (called with the target id) — one pair of functions, no duplication.
-- Commission status is derived live via payout_commissions/payouts, never
-- stored (commission_ledger stays immutable) — see plan doc.

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
  entry_type text, commission_status text, payout_id uuid, created_at timestamptz, total_count bigint
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
      cl.entry_type::text AS entry_type,
      CASE
        WHEN cl.entry_type = 'reversal' THEN 'reversed'
        WHEN pc.payout_id IS NULL THEN 'available'
        ELSE p.status::text
      END AS commission_status,
      pc.payout_id, cl.created_at
    FROM public.commission_ledger cl
    LEFT JOIN public.orders o ON o.id = cl.order_id
    LEFT JOIN public.payout_commissions pc ON pc.commission_ledger_id = cl.id
    LEFT JOIN public.payouts p ON p.id = pc.payout_id
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

-- Symmetric driver version — same shape, visibility via drivers.user_id.
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
  entry_type text, commission_status text, payout_id uuid, created_at timestamptz, total_count bigint
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
      cl.entry_type::text AS entry_type,
      CASE
        WHEN cl.entry_type = 'reversal' THEN 'reversed'
        WHEN pc.payout_id IS NULL THEN 'available'
        ELSE p.status::text
      END AS commission_status,
      pc.payout_id, cl.created_at
    FROM public.commission_ledger cl
    LEFT JOIN public.orders o ON o.id = cl.order_id
    LEFT JOIN public.payout_commissions pc ON pc.commission_ledger_id = cl.id
    LEFT JOIN public.payouts p ON p.id = pc.payout_id
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

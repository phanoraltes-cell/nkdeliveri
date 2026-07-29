-- Centre de Décaissement — closes the 2 real gaps found in the audit:
-- (A) no method/period filter on the admin payout queue, (B) no
-- logo/photo/phone shown per row (Phase 3 of the request), matching what
-- Jesyon Restoran/Jesyon Livrè already got in the previous migration.
-- Both functions change their RETURNS TABLE shape, so DROP+CREATE rather
-- than CREATE OR REPLACE (same reason as 20260729210000).

DROP FUNCTION IF EXISTS public.get_restaurant_wallets_admin(text, text, text, int, int);

CREATE FUNCTION public.get_restaurant_wallets_admin(
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _sort text DEFAULT 'priority',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _method text DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL
)
RETURNS TABLE(
  restaurant_id uuid, name text, phone text, logo_url text,
  moncash_number text, moncash_account_name text, natcash_number text, natcash_account_name text,
  available_balance numeric, pending_balance numeric, paid_balance numeric, lifetime_earnings numeric,
  total_orders int, last_payment_date timestamptz, computed_status text,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
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
    SELECT r.id AS restaurant_id, r.name, r.phone, r.logo_url,
      pd.moncash_number, pd.moncash_account_name, pd.natcash_number, pd.natcash_account_name,
      COALESCE(w.available_balance, 0) AS available_balance,
      COALESCE(w.pending_balance, 0) AS pending_balance,
      COALESCE(w.paid_balance, 0) AS paid_balance,
      COALESCE(w.lifetime_earnings, 0) AS lifetime_earnings,
      COALESCE(oc.total_orders, 0) AS total_orders,
      lp2.last_payment_date,
      ouc.oldest_unpaid_commission,
      CASE
        WHEN COALESCE(w.available_balance, 0) > 0 THEN 'pending'
        WHEN lp.status = 'disputed' THEN 'disputed'
        WHEN lp.status IN ('paid', 'confirmed', 'resolved') THEN 'paid'
        ELSE 'settled'
      END AS computed_status
    FROM public.restaurants r
    LEFT JOIN public.restaurant_payout_details pd ON pd.restaurant_id = r.id
    LEFT JOIN public.wallets w ON w.restaurant_id = r.id
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_orders FROM public.commission_ledger cl
      WHERE cl.restaurant_id = r.id AND cl.entry_type = 'order_commission'
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT max(p.created_at) AS last_payment_date FROM public.payouts p
      WHERE p.restaurant_id = r.id AND p.status IN ('paid', 'confirmed', 'resolved')
    ) lp2 ON true
    LEFT JOIN LATERAL (
      SELECT min(cl.created_at) AS oldest_unpaid_commission
      FROM public.commission_ledger cl
      LEFT JOIN LATERAL (
        SELECT sum(pc.covered_amount) AS covered
        FROM public.payout_commissions pc
        WHERE pc.commission_ledger_id = cl.id
      ) pc_sum ON true
      WHERE cl.restaurant_id = r.id AND cl.entry_type = 'order_commission' AND cl.net_amount > 0
        AND COALESCE(pc_sum.covered, 0) < cl.net_amount
    ) ouc ON true
    LEFT JOIN LATERAL (
      SELECT status FROM public.payouts p WHERE p.restaurant_id = r.id ORDER BY p.created_at DESC LIMIT 1
    ) lp ON true
    WHERE r.owner_id IS NOT NULL
  )
  SELECT
    b.restaurant_id, b.name, b.phone, b.logo_url,
    b.moncash_number, b.moncash_account_name, b.natcash_number, b.natcash_account_name,
    b.available_balance, b.pending_balance, b.paid_balance, b.lifetime_earnings,
    b.total_orders, b.last_payment_date, b.computed_status, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.name ILIKE '%' || _search || '%')
    AND (_status IS NULL OR b.computed_status = _status)
    -- Method = which rail this beneficiary is even configured to receive on
    -- — lets the admin filter down to "who can I pay via MonCash right now"
    -- before opening the payout wizard, rather than filtering past payouts.
    AND (_method IS NULL
      OR (_method = 'moncash' AND b.moncash_number IS NOT NULL)
      OR (_method = 'natcash' AND b.natcash_number IS NOT NULL))
    -- Period = when their oldest still-unpaid commission was earned, i.e.
    -- "who's been waiting since this window" — not last_payment_date, which
    -- would wrongly exclude anyone never paid yet.
    AND (_from IS NULL OR b.oldest_unpaid_commission IS NULL OR b.oldest_unpaid_commission::date >= _from)
    AND (_to IS NULL OR b.oldest_unpaid_commission IS NULL OR b.oldest_unpaid_commission::date <= _to)
  ORDER BY
    CASE WHEN _sort = 'balance_asc' THEN b.available_balance END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN b.name END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN b.name END DESC NULLS LAST,
    CASE WHEN _sort = 'last_payment_desc' THEN b.last_payment_date END DESC NULLS LAST,
    CASE WHEN _sort = 'oldest_unpaid_commission' THEN b.oldest_unpaid_commission END ASC NULLS LAST,
    CASE WHEN _sort = 'oldest_last_payment' THEN b.last_payment_date END ASC NULLS FIRST,
    b.available_balance DESC,
    b.oldest_unpaid_commission ASC NULLS LAST,
    b.last_payment_date ASC NULLS FIRST
  LIMIT _limit OFFSET _offset;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_restaurant_wallets_admin(text, text, text, int, int, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_restaurant_wallets_admin(text, text, text, int, int, text, date, date) TO authenticated;


DROP FUNCTION IF EXISTS public.get_driver_wallets_admin(text, text, text, int, int);

CREATE FUNCTION public.get_driver_wallets_admin(
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _sort text DEFAULT 'priority',
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _method text DEFAULT NULL,
  _from date DEFAULT NULL,
  _to date DEFAULT NULL
)
RETURNS TABLE(
  driver_id uuid, name text, phone text, id_doc_url text,
  moncash_number text, moncash_account_name text, natcash_number text, natcash_account_name text,
  available_balance numeric, pending_balance numeric, paid_balance numeric, lifetime_earnings numeric,
  total_orders int, last_payment_date timestamptz, computed_status text,
  total_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin')) THEN
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
    SELECT dr.id AS driver_id, trim(COALESCE(dr.first_name, '') || ' ' || COALESCE(dr.last_name, '')) AS name,
      dr.phone, dr.id_doc_url,
      dr.moncash_number, dr.moncash_account_name, dr.natcash_number, dr.natcash_account_name,
      COALESCE(w.available_balance, 0) AS available_balance,
      COALESCE(w.pending_balance, 0) AS pending_balance,
      COALESCE(w.paid_balance, 0) AS paid_balance,
      COALESCE(w.lifetime_earnings, 0) AS lifetime_earnings,
      COALESCE(oc.total_orders, 0) AS total_orders,
      lp2.last_payment_date,
      ouc.oldest_unpaid_commission,
      CASE
        WHEN COALESCE(w.available_balance, 0) > 0 THEN 'pending'
        WHEN lp.status = 'disputed' THEN 'disputed'
        WHEN lp.status IN ('paid', 'confirmed', 'resolved') THEN 'paid'
        ELSE 'settled'
      END AS computed_status
    FROM public.drivers dr
    LEFT JOIN public.wallets w ON w.driver_id = dr.id
    LEFT JOIN LATERAL (
      SELECT count(*) AS total_orders FROM public.commission_ledger cl
      WHERE cl.driver_id = dr.id AND cl.entry_type = 'order_commission'
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT max(p.created_at) AS last_payment_date FROM public.payouts p
      WHERE p.driver_id = dr.id AND p.status IN ('paid', 'confirmed', 'resolved')
    ) lp2 ON true
    LEFT JOIN LATERAL (
      SELECT min(cl.created_at) AS oldest_unpaid_commission
      FROM public.commission_ledger cl
      LEFT JOIN LATERAL (
        SELECT sum(pc.covered_amount) AS covered
        FROM public.payout_commissions pc
        WHERE pc.commission_ledger_id = cl.id
      ) pc_sum ON true
      WHERE cl.driver_id = dr.id AND cl.entry_type = 'order_commission' AND cl.net_amount > 0
        AND COALESCE(pc_sum.covered, 0) < cl.net_amount
    ) ouc ON true
    LEFT JOIN LATERAL (
      SELECT status FROM public.payouts p WHERE p.driver_id = dr.id ORDER BY p.created_at DESC LIMIT 1
    ) lp ON true
  )
  SELECT
    b.driver_id, b.name, b.phone, b.id_doc_url,
    b.moncash_number, b.moncash_account_name, b.natcash_number, b.natcash_account_name,
    b.available_balance, b.pending_balance, b.paid_balance, b.lifetime_earnings,
    b.total_orders, b.last_payment_date, b.computed_status, count(*) OVER()
  FROM base b
  WHERE (_search IS NULL OR b.name ILIKE '%' || _search || '%')
    AND (_status IS NULL OR b.computed_status = _status)
    AND (_method IS NULL
      OR (_method = 'moncash' AND b.moncash_number IS NOT NULL)
      OR (_method = 'natcash' AND b.natcash_number IS NOT NULL))
    AND (_from IS NULL OR b.oldest_unpaid_commission IS NULL OR b.oldest_unpaid_commission::date >= _from)
    AND (_to IS NULL OR b.oldest_unpaid_commission IS NULL OR b.oldest_unpaid_commission::date <= _to)
  ORDER BY
    CASE WHEN _sort = 'balance_asc' THEN b.available_balance END ASC NULLS LAST,
    CASE WHEN _sort = 'name_asc' THEN b.name END ASC NULLS LAST,
    CASE WHEN _sort = 'name_desc' THEN b.name END DESC NULLS LAST,
    CASE WHEN _sort = 'last_payment_desc' THEN b.last_payment_date END DESC NULLS LAST,
    CASE WHEN _sort = 'oldest_unpaid_commission' THEN b.oldest_unpaid_commission END ASC NULLS LAST,
    CASE WHEN _sort = 'oldest_last_payment' THEN b.last_payment_date END ASC NULLS FIRST,
    b.available_balance DESC,
    b.oldest_unpaid_commission ASC NULLS LAST,
    b.last_payment_date ASC NULLS FIRST
  LIMIT _limit OFFSET _offset;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_driver_wallets_admin(text, text, text, int, int, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_wallets_admin(text, text, text, int, int, text, date, date) TO authenticated;

-- Real production incident (2026-08-10): a customer reported "Sa a pa
-- kòrèk" on a kach order (dispute_cash_payment_secure ->
-- open_dispute_secure with _category_group := 'payment'). The
-- dispute_opened notification went ONLY to the restaurant owner — no
-- admin/super_admin was ever notified. Confirmed via direct query: the
-- one real 'payment'-category dispute in production has its
-- dispute_opened notification row's user_id matching the restaurant
-- owner, nobody else.
--
-- Root cause: open_dispute_secure's notification INSERT always targets
-- public.restaurants.owner_id, regardless of category_group. This is
-- correct for 'restaurant'/'delivery'/'driver' disputes (the restaurant
-- is a real party) but wrong for 'payment' disputes specifically — a kach
-- order's payment always has receiver_type='admin' and
-- receiver_restaurant_id=NULL (private.create_order_secure,
-- 20260722200000_cash_double_confirmation.sql) -- the restaurant is never
-- the receiver of that cash and has no stake in reconciling it. The
-- restaurant also cannot act on it: resolve_dispute_secure and
-- update_dispute_status_secure are both admin/super_admin-only.
-- get_disputes_admin already lists every dispute regardless of category
-- once an admin opens the Litij page manually (confirmed, no filter
-- excludes 'payment') — but nothing ever prompted them to look.
--
-- Fix: route the notification by category_group instead of unconditionally
-- to the restaurant. 'payment' -> every admin/super_admin (DISTINCT, so a
-- user holding both roles isn't notified twice); everything else ->
-- restaurant owner, byte-identical to the previous behavior. Same
-- signature as the currently-live version (uuid, text, text, text DEFAULT
-- 'delivery') -- safe CREATE OR REPLACE, no DROP needed. Every other part
-- of the function body (validation, rate limiting, the reopen-on-
-- resolved/rejected upsert, message insertion) is unchanged.
CREATE OR REPLACE FUNCTION public.open_dispute_secure(
  _order_id uuid, _category text, _description text, _category_group text DEFAULT 'delivery'
)
RETURNS public.disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_driver_id uuid;
  v_row public.disputes;
  v_author_role public.dispute_author_role;
  v_category_group text := COALESCE(NULLIF(btrim(_category_group), ''), 'delivery');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _description IS NULL OR length(btrim(_description)) < 5 THEN
    RAISE EXCEPTION 'Tanpri eksplike pwoblèm nan (omwen 5 karaktè)';
  END IF;
  IF _category IS NULL OR length(btrim(_category)) = 0 THEN
    RAISE EXCEPTION 'Chwazi yon kategori';
  END IF;
  IF v_category_group NOT IN ('payment', 'delivery', 'restaurant', 'driver') THEN
    RAISE EXCEPTION 'Gwoup kategori envalid';
  END IF;

  IF NOT public.check_rate_limit_secure('open_dispute', 5, 1800) THEN
    RAISE EXCEPTION 'Twòp demann. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = '42501';
  END IF;

  SELECT dr.id INTO v_driver_id
  FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
  WHERE de.order_id = _order_id;

  IF NOT (
    v_order.customer_id = v_user
    OR (v_driver_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.drivers dr WHERE dr.id = v_driver_id AND dr.user_id = v_user))
  ) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.disputes (order_id, customer_id, restaurant_id, driver_id, category, category_group)
  VALUES (_order_id, v_order.customer_id, v_order.restaurant_id, v_driver_id, btrim(_category), v_category_group)
  ON CONFLICT (order_id) DO UPDATE SET
    status = 'open', category = EXCLUDED.category, category_group = EXCLUDED.category_group,
    driver_id = EXCLUDED.driver_id, assigned_to = NULL,
    status_history = disputes.status_history || jsonb_build_object(
      'from', disputes.status, 'to', 'open', 'by', v_user, 'at', now(), 'notes', 'reouvri'
    ),
    resolution = NULL, resolved_by = NULL, resolved_at = NULL, updated_at = now()
  WHERE disputes.status IN ('resolved', 'rejected')
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gen deja yon litij louvri pou kòmand sa a';
  END IF;

  v_author_role := private.dispute_author_role(v_row);

  INSERT INTO public.dispute_messages (dispute_id, author_id, author_role, message)
  VALUES (v_row.id, v_user, COALESCE(v_author_role, 'customer'), btrim(_description));

  IF v_category_group = 'payment' THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT DISTINCT ur.user_id, 'dispute_opened', 'Nouvo litij peman kach',
      'Yon ' || (CASE WHEN v_author_role = 'driver' THEN 'livrè' ELSE 'kliyan' END)
        || ' siyale yon pwoblèm peman kach sou kòmand ' || v_order.order_number || '.',
      jsonb_build_object('order_id', v_order.id, 'dispute_id', v_row.id)
    FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin');
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT r.owner_id, 'dispute_opened', 'Nouvo litij sou yon kòmand',
      'Yon ' || (CASE WHEN v_author_role = 'driver' THEN 'livrè' ELSE 'kliyan' END)
        || ' siyale yon pwoblèm sou kòmand ' || v_order.order_number || '.',
      jsonb_build_object('order_id', v_order.id, 'dispute_id', v_row.id)
    FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL;
  END IF;

  RETURN v_row;
END;
$$;
-- Same signature as before -- no DROP/GRANT changes needed.

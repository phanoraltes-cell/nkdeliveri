-- NKD-020 combined migration + test — WRITTEN, per Règ A1 run this yourself
-- in the SQL Editor (or explicitly authorize it) — never CLI. BEGIN...
-- ROLLBACK — nothing here survives, including the migration itself. Format
-- per Règ A10: results in a temp table + SELECT before ROLLBACK.
--
-- STRICT step-up (private.require_admin_step_up_strict()) needs a real
-- verified TOTP factor + an 'aal2' JWT claim to return 'ok' (confirmed by
-- reading private.admin_step_up_status() verbatim). This test simulates
-- both directly — a fake row in auth.mfa_factors (status='verified',
-- last_challenged_at=now()) plus 'aal':'aal2' in the same simulated JWT
-- claims this project's tests already use for auth.uid()/has_role — so the
-- full success path (not just the rejection paths) is actually exercised,
-- not left NOT-TESTED.

BEGIN;

-- =====================  MIGRATION (rehearsal)  =====================
-- Verbatim copy of 20260819100000_nkd020_customer_anonymization.sql.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_by uuid REFERENCES auth.users(id);

CREATE OR REPLACE FUNCTION public.anonymize_customer_secure(_customer_id uuid, _reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin uuid := auth.uid();
BEGIN
  IF NOT (public.has_role(v_admin, 'admin') OR public.has_role(v_admin, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM private.require_admin_step_up_strict();

  IF _customer_id IS NULL THEN
    RAISE EXCEPTION 'Kont kliyan an obligatwa.';
  END IF;
  IF _customer_id = v_admin THEN
    RAISE EXCEPTION 'Ou pa ka anonimize pwòp kont ou.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _customer_id AND role = 'customer'
  ) THEN
    RAISE EXCEPTION 'Kont sa a pa gen wòl kliyan.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _customer_id AND role <> 'customer'
  ) THEN
    RAISE EXCEPTION 'Zouti sa a sèlman pou kont ki gen sèlman wòl kliyan (NKD-020, pòte limite).';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _customer_id AND anonymized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Kont sa a deja anonimize.';
  END IF;

  UPDATE public.profiles
  SET first_name = '[Efase]',
      last_name = NULL,
      phone = NULL,
      address = NULL,
      avatar_url = NULL,
      anonymized_at = now(),
      anonymized_by = v_admin
  WHERE id = _customer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pwofil pa jwenn.';
  END IF;

  UPDATE public.addresses
  SET label = NULL, address_line = '[Efase]', notes = NULL, lat = NULL, lng = NULL
  WHERE user_id = _customer_id;

  DELETE FROM public.favorites WHERE user_id = _customer_id;
  DELETE FROM public.push_subscriptions WHERE user_id = _customer_id;

  DELETE FROM public.customer_delivery_locations cdl
    USING public.deliveries d, public.orders o
    WHERE cdl.delivery_id = d.id AND d.order_id = o.id AND o.customer_id = _customer_id;

  PERFORM private.log_audit_event(v_admin, 'admin', 'customer_anonymized',
    jsonb_build_object('customer_id', _customer_id, 'reason', _reason));
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_customer_secure(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.anonymize_customer_secure(uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.get_all_users_admin(text, int, int, public.app_role);
CREATE FUNCTION public.get_all_users_admin(
  _search text DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0,
  _role public.app_role DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz,
  roles text[],
  banned_until timestamptz,
  anonymized_at timestamptz,
  total_count bigint
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
  IF _limit IS NULL OR _limit <= 0 OR _limit > 500 THEN
    _limit := 50;
  END IF;
  IF _offset IS NULL OR _offset < 0 THEN
    _offset := 0;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    u.email::text,
    p.first_name,
    p.last_name,
    p.phone,
    p.created_at,
    COALESCE(array_agg(DISTINCT ur.role::text) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::text[]),
    u.banned_until,
    p.anonymized_at,
    count(*) OVER()
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE (
    _search IS NULL
     OR u.email ILIKE '%' || _search || '%'
     OR p.first_name ILIKE '%' || _search || '%'
     OR p.last_name ILIKE '%' || _search || '%'
     OR p.phone ILIKE '%' || _search || '%'
  )
  AND (
    _role IS NULL
    OR EXISTS (SELECT 1 FROM public.user_roles ur2 WHERE ur2.user_id = p.id AND ur2.role = _role)
  )
  GROUP BY p.id, u.email, p.first_name, p.last_name, p.phone, p.created_at, u.banned_until, p.anonymized_at
  ORDER BY p.created_at DESC
  LIMIT _limit OFFSET _offset;
END;
$$;
REVOKE ALL ON FUNCTION public.get_all_users_admin(text, int, int, public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_users_admin(text, int, int, public.app_role) TO authenticated;

-- =====================  TEST (Règ A10 format)  =====================

CREATE TEMP TABLE test_results (tes text PRIMARY KEY, rezilta text, detay text);

DO $$
DECLARE
  v_admin uuid := gen_random_uuid();
  v_customer uuid := gen_random_uuid();          -- pure customer, target of a full success run
  v_mixed uuid := gen_random_uuid();              -- customer AND driver -- must be rejected
  v_addr_id uuid := gen_random_uuid();
  v_delivery_id uuid := gen_random_uuid();
  v_restaurant uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_row record;
  v_caught boolean;
  v_errmsg text;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_admin, 'nkd020-admin@example.com', 'x', now(), '{}', '{}'),
    (v_customer, 'nkd020-customer@example.com', 'x', now(), '{}', '{}'),
    (v_mixed, 'nkd020-mixed@example.com', 'x', now(), '{}', '{}'),
    (v_owner, 'nkd020-owner@example.com', 'x', now(), '{}', '{}');
  -- handle_new_user() already fired on the auth.users INSERT above (every
  -- row's raw_user_meta_data is '{}', so account_type defaults to
  -- 'customer' — see the trigger's own COALESCE) and auto-inserted a
  -- 'customer' user_roles row for all four via ON CONFLICT DO NOTHING.
  -- Only add the roles that default does NOT already cover: v_admin needs
  -- 'admin' on top of its (harmless, unused) auto 'customer' row; v_mixed
  -- needs 'driver' added to its auto 'customer' row (that's the whole
  -- point of v_mixed); v_owner needs 'restaurant_owner'. Re-inserting
  -- 'customer' explicitly for v_customer/v_mixed here is exactly what
  -- produced the duplicate-key error on user_roles_user_id_role_key.
  INSERT INTO public.user_roles (user_id, role) VALUES
    (v_admin, 'admin'), (v_mixed, 'driver'), (v_owner, 'restaurant_owner');
  INSERT INTO public.addresses (id, user_id, label, address_line)
  VALUES (v_addr_id, v_customer, 'Lakay', '123 Ri Test');

  -- Fake order/delivery so the customer_delivery_locations cleanup path
  -- (a join through deliveries->orders) has something real to touch.
  INSERT INTO public.restaurants (id, owner_id, slug, name, status, delivery_fee)
  VALUES (v_restaurant, v_owner, 'nkd020-test-resto', 'NKD020 Test Resto', 'approved', 0);
  INSERT INTO public.orders (id, customer_id, restaurant_id, delivery_address, contact_phone, status)
  VALUES (v_order, v_customer, v_restaurant, '123 Ri Test', '+50912345678', 'delivered');
  INSERT INTO public.deliveries (id, order_id, status)
  VALUES (v_delivery_id, v_order, 'delivered');

  -- T1 — non-admin rejected (no role at all on v_customer as caller).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_customer, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.anonymize_customer_secure(v_mixed);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T1', CASE WHEN v_caught AND v_errmsg = 'Forbidden' THEN 'PASS' ELSE 'FAIL' END,
    'kliyan pa admin rejte: ' || v_caught::text || ' msg=' || COALESCE(v_errmsg, ''));

  -- T2 — admin caller, but no fresh STRICT step-up (no mfa_factors row,
  -- no aal2 claim) -- must fail with STEP_UP_REQUIRED_MFA before the
  -- scope-guard logic even runs.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.anonymize_customer_secure(v_customer);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T2',
    CASE WHEN v_caught AND v_errmsg LIKE 'STEP_UP_REQUIRED_MFA%' THEN 'PASS' ELSE 'FAIL' END,
    'admin san step-up fre rejte: ' || v_caught::text || ' msg=' || COALESCE(v_errmsg, ''));

  -- From here on, simulate a fresh STRICT-satisfying session for v_admin:
  -- a verified TOTP factor + aal2 in the JWT claims (matches
  -- private.admin_step_up_status()'s own 'ok' condition, read verbatim
  -- before writing this test).
  INSERT INTO auth.mfa_factors (id, user_id, friendly_name, factor_type, status, secret, created_at, updated_at, last_challenged_at)
  VALUES (gen_random_uuid(), v_admin, 'nkd020-test-totp', 'totp', 'verified', 'test-secret', now(), now(), now());

  -- T3 — admin WITH fresh step-up, but target has a non-customer role too
  -- (v_mixed) -- scope guard must reject before touching any data.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.anonymize_customer_secure(v_mixed);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T3',
    CASE WHEN v_caught AND v_errmsg LIKE '%sèlman pou kont ki gen sèlman wòl kliyan%' THEN 'PASS' ELSE 'FAIL' END,
    'kont mikst (customer+driver) rejte: ' || v_caught::text || ' msg=' || COALESCE(v_errmsg, ''));

  -- T4 — admin cannot anonymize themselves.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.anonymize_customer_secure(v_admin);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T4', CASE WHEN v_caught THEN 'PASS' ELSE 'FAIL' END,
    'admin pa ka anonimize tèt li: ' || v_caught::text || ' msg=' || COALESCE(v_errmsg, ''));

  -- T5 — THE SUCCESS PATH: admin, fresh STRICT step-up, pure-customer
  -- target -> profiles scrubbed.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  PERFORM public.anonymize_customer_secure(v_customer, 'test reason');
  RESET ROLE;
  SELECT first_name, last_name, phone, address, anonymized_at, anonymized_by INTO v_row
  FROM public.profiles WHERE id = v_customer;
  INSERT INTO test_results VALUES ('T5',
    CASE WHEN v_row.first_name = '[Efase]' AND v_row.last_name IS NULL AND v_row.phone IS NULL
           AND v_row.address IS NULL AND v_row.anonymized_at IS NOT NULL AND v_row.anonymized_by = v_admin
         THEN 'PASS' ELSE 'FAIL' END,
    'profiles scrubbed: first=' || COALESCE(v_row.first_name, 'NULL') || ' anonymized_by_ok=' || (v_row.anonymized_by = v_admin)::text);

  -- T6 — addresses row scrubbed too.
  SELECT address_line, label INTO v_row FROM public.addresses WHERE id = v_addr_id;
  INSERT INTO test_results VALUES ('T6',
    CASE WHEN v_row.address_line = '[Efase]' AND v_row.label IS NULL THEN 'PASS' ELSE 'FAIL' END,
    'address_line=' || COALESCE(v_row.address_line, 'NULL'));

  -- T7 — historical order data explicitly LEFT ALONE (owner-confirmed
  -- decision) -- the order's delivery_address/contact_phone must survive
  -- untouched.
  SELECT delivery_address, contact_phone INTO v_row FROM public.orders WHERE id = v_order;
  INSERT INTO test_results VALUES ('T7',
    CASE WHEN v_row.delivery_address = '123 Ri Test' AND v_row.contact_phone = '+50912345678' THEN 'PASS' ELSE 'FAIL' END,
    'done istorik entak: ' || v_row.delivery_address);

  -- T8 — re-running on an already-anonymized account is rejected
  -- (idempotency guard).
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  v_caught := false;
  BEGIN
    PERFORM public.anonymize_customer_secure(v_customer);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    GET STACKED DIAGNOSTICS v_errmsg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T8',
    CASE WHEN v_caught AND v_errmsg LIKE '%deja anonimize%' THEN 'PASS' ELSE 'FAIL' END,
    'doub anonimizasyon rejte: ' || v_caught::text || ' msg=' || COALESCE(v_errmsg, ''));

  -- T9 — get_all_users_admin surfaces anonymized_at for the row.
  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  SELECT anonymized_at INTO v_row FROM public.get_all_users_admin(NULL, 500, 0, NULL) WHERE id = v_customer;
  RESET ROLE;
  INSERT INTO test_results VALUES ('T9',
    CASE WHEN v_row.anonymized_at IS NOT NULL THEN 'PASS' ELSE 'FAIL' END,
    'get_all_users_admin.anonymized_at=' || COALESCE(v_row.anonymized_at::text, 'NULL'));
END;
$$;

SELECT * FROM test_results ORDER BY tes;

ROLLBACK;

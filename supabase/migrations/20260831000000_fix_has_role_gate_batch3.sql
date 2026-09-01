-- FIX (swit odit tout baz la, kontinyasyon) — swit 3 nan koreksyon
-- 20260830170000 / 20260830180000 : menm bug la egzakteman (`has_role` rele
-- SAN prefiks `private.` anndan yon kò `SECURITY DEFINER`, ki fè gad la bay
-- `false` pa erè pou yon vrè admin), men jwenn NAN yon dezyèm pas separe.
--
-- METÒD : yon script `awk` ki suiv chak `CREATE (OR REPLACE )?FUNCTION
-- (public|private)\.` epi atribye chak itilizasyon `has_role` anndan yon kò
-- fonksyon (pa yon RLS policy) bay dènye fonksyon li wè a, aplike sou tout
-- 168 migrasyon yo. Rezilta a reprodui egzakteman lis 38 fonksyon deja
-- korije yo (8 nan 20260830170000 + 30 nan 20260830180000), PLIS 3 fonksyon
-- ANKÒ ke ni premye pas mwen an ni odit Altes la pa t jwenn — paske tou de
-- t ap chèche non ki fini an `_secure`/`_admin` anba schema `public`, men 3
-- fonksyon sa yo viv anba schema `private` ak yon non ki pa suiv konvansyon
-- sa a:
--   - private.update_order_status_secure(uuid, order_status)
--   - private.order_chat_author_role(uuid)
--   - private.dispute_author_role(disputes)
--
-- Pou chak fonksyon, kò a rekopye EGZAKTEMAN jan li anvigè kounye a (dènye
-- CREATE OR REPLACE ki defini l — verifye ak yon grep sou tout istwa
-- migrasyon yo), sèl chanjman an se `public.has_role(...)` →
-- `private.has_role(...)`. Okenn lòt lojik, okenn siyati chanje — CREATE OR
-- REPLACE sèlman, pa gen DROP FUNCTION (siyati yo idantik, konfime ak
-- `npm run check:migrations`).
--
-- ==========================================================================
-- KLASIFIKASYON (menm gid Altes te mande nan 20260830180000 la) :
--
-- TIP 1 — "bug senp" pou 2 nan 3 yo (private.update_order_status_secure,
-- private.order_chat_author_role) : `has_role` k ap bay `false` pa erè
-- toujou mennen nan chemen ki PI RESTRIKTIF la (yon EGZANSYON 'Forbidden',
-- oswa — pou order_chat_author_role, ki rele DIRÈKTEMAN nan yon policy RLS
-- — yon `RETURN NULL` ki fè policy a filtre TOUT liy pou admin an, san
-- okenn erè). Nan tou de ka, admin lejitim nan pèdi aksè; okenn moun ki pa
-- dwe pase pa ka pase.
--
-- TIP "ADJASAN — enpak kaskad", pa yon nouvo Tip 2, pou 3yèm nan
-- (private.dispute_author_role) : sa a pa yon nouvo twou konfidansyalite —
-- men li EKSPLIKE poukisa koreksyon 20260830180000 pou
-- add_dispute_message_secure pa t ase sèl li menm. add_dispute_message_secure
-- rele private.dispute_author_role(v_dispute) AVAN menm rive nan pwòp
-- `v_is_admin` pa li a; si dispute_author_role bay `NULL` pou yon admin,
-- `IF v_role IS NULL THEN RAISE EXCEPTION 'Forbidden'` deklanche La menm,
-- e admin nan pa janm rive jis nan chèk `_is_internal` ki te deja korije a.
-- Koreksyon sa a (private.has_role anndan dispute_author_role) se sa ki
-- FINALMAN retabli kapasite admin pou ekri mesaj nan yon litij nèt.
--
-- Ankò menm konklizyon an: okenn nan 3 fonksyon sa yo pa gen yon vrè "twou
-- sekirite" (has_role=false pa erè k ap KITE yon moun pase kote li pa dwe)
-- — chak chemen ki afekte a vin PI restriktif, jamè mwens.
--
-- KONSEKANS METYE KONFIME (odit Faz 5, pa yon sipozisyon): tank
-- update_order_status_secure pa korije, yon kòmand ki rive `delivery_failed`
-- pa gen OKENN chemen pou soti — ni kliyan, ni restoran, ni livrè gen
-- `delivery_failed` kòm estati sous nan lis transisyon yo pèmèt, e admin
-- (sèl chemen ki prevwa espesyalman pou sa, wè 20260817120000:311-324 ak
-- :451) bloke pa menm bug `has_role` sa a. Ranbousman pa yon chemen altènatif
-- nonplis: request_refund_secure egzije `status IN ('delivered','cancelled')`
-- (20260714130000_refunds.sql:89) — 'delivery_failed' pa nan ni yonn ni lòt.
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1) private.update_order_status_secure(uuid, order_status) — TIP 1.
--    Dènye definisyon anvigè: 20260817120000_nkd016_delivery_failed.sql:325.
CREATE OR REPLACE FUNCTION private.update_order_status_secure(_order_id uuid, _new_status public.order_status)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_old_status public.order_status;
  v_is_admin boolean;
  v_is_restaurant_owner boolean;
  v_is_assigned_driver boolean;
  v_is_customer boolean;
  v_allowed boolean := false;
  v_status_label text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  v_old_status := v_order.status;

  v_is_admin := private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin');
  v_is_restaurant_owner := EXISTS (
    SELECT 1 FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id = v_user
  ) OR EXISTS (
    SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = v_order.restaurant_id AND e.user_id = v_user
  );
  v_is_assigned_driver := EXISTS (
    SELECT 1 FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
    WHERE d.order_id = v_order.id AND dr.user_id = v_user
  );
  v_is_customer := v_order.customer_id = v_user;

  IF NOT (v_is_admin OR v_is_restaurant_owner OR v_is_assigned_driver OR v_is_customer) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_is_admin THEN
    v_allowed := true;
  ELSIF v_is_customer THEN
    IF NOT public.check_rate_limit_secure('cancel_order_customer', 5, 3600) THEN
      RAISE EXCEPTION 'Twòp demann anilasyon. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
    END IF;
    v_allowed := _new_status = 'cancelled' AND v_order.status IN ('pending', 'confirmed');
  ELSIF v_is_restaurant_owner THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('pending','confirmed'), ('confirmed','preparing'), ('preparing','ready'),
      ('pending','cancelled'), ('confirmed','cancelled'), ('preparing','cancelled'), ('ready','cancelled')
    );
    IF v_allowed AND v_order.status = 'pending' AND _new_status = 'confirmed' THEN
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.method IN ('moncash', 'natcash')
          AND p.status <> 'paid'
          AND NOT EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.payment_id = p.id)
      ) THEN
        RAISE EXCEPTION 'Peman an poko verifye. Tann yon admin konfime prèv peman an anvan w konfime kòmand la.' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.method IN ('moncash', 'natcash')
          AND p.status <> 'paid'
          AND EXISTS (SELECT 1 FROM public.payment_transactions pt WHERE pt.payment_id = p.id)
      ) THEN
        RAISE EXCEPTION 'Peman otomatik la poko konfime. N ap tann konfimasyon sistèm peman an anvan kòmand lan ka konfime — pa gen okenn aksyon admin ki nesesè.' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSIF v_is_assigned_driver THEN
    v_allowed := (v_order.status, _new_status) IN (
      ('ready','assigned'), ('assigned','picked_up'), ('picked_up','delivered')
    );
  END IF;

  IF NOT v_allowed THEN
    IF v_is_customer THEN
      RAISE EXCEPTION 'Ou pa ka anile kòmand sa a ankò — restoran an deja kòmanse prepare l.';
    END IF;
    RAISE EXCEPTION 'Illegal status transition: % -> %', v_order.status, _new_status;
  END IF;

  UPDATE public.orders
     SET status = _new_status,
         status_history = status_history || jsonb_build_object(
           'from', v_order.status, 'to', _new_status,
           'by', v_user, 'at', now()
         ),
         updated_at = now()
   WHERE id = _order_id
   RETURNING * INTO v_order;

  -- NKD-016: 'delivery_failed' excluded on top of the NKD-010 guard -- the
  -- food was already made and handed off, it must not return to stock
  -- when this order later reaches 'cancelled' from 'delivery_failed'.
  IF _new_status IN ('cancelled', 'refunded') AND v_old_status NOT IN ('cancelled', 'refunded', 'delivery_failed') THEN
    UPDATE public.products p
    SET stock_quantity = p.stock_quantity + oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = v_order.id AND oi.product_id = p.id AND p.stock_quantity IS NOT NULL;
  END IF;

  IF _new_status IN ('cancelled', 'delivered') THEN
    DELETE FROM public.customer_delivery_locations
    WHERE delivery_id IN (SELECT id FROM public.deliveries WHERE order_id = v_order.id);
  END IF;

  IF v_is_customer AND _new_status = 'cancelled' THEN
    PERFORM private.log_audit_event(v_user, 'customer', 'order.cancelled_by_customer',
      jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number));
    PERFORM private.notify_secure(
      ARRAY(
        SELECT r.owner_id FROM public.restaurants r WHERE r.id = v_order.restaurant_id AND r.owner_id IS NOT NULL
        UNION
        SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')
      ),
      'order_cancelled_by_customer', 'order', 'Kliyan anile yon kòmand',
      'Kliyan an anile kòmand ' || v_order.order_number || ' anvan preparasyon kòmanse.',
      jsonb_build_object('order_id', v_order.id)
    );
  ELSIF _new_status = 'cancelled' AND v_old_status = 'delivery_failed' THEN
    INSERT INTO public.notifications (user_id, type, category, title, body, data)
    VALUES (
      v_order.customer_id, 'order_status_changed', 'order', 'Kòmand ou a anile',
      'Kòmand ' || v_order.order_number || ' anile — manje a pa disponib ankò. Pa gen ranbousman, jan sa te make lè n te siyale pwoblèm livrezon an.',
      jsonb_build_object('order_id', v_order.id, 'status', _new_status)
    );
  ELSIF _new_status IN ('confirmed', 'preparing', 'ready', 'cancelled') THEN
    v_status_label := CASE _new_status
      WHEN 'confirmed' THEN 'konfime'
      WHEN 'preparing' THEN 'ap prepare'
      WHEN 'ready' THEN 'prè pou livrezon'
      WHEN 'cancelled' THEN 'anile'
    END;
    INSERT INTO public.notifications (user_id, type, category, title, body, data)
    VALUES (
      v_order.customer_id, 'order_status_changed', 'order', 'Kòmand ou a ' || v_status_label,
      'Kòmand ' || v_order.order_number || ' kounye a ' || v_status_label || '.',
      jsonb_build_object('order_id', v_order.id, 'status', _new_status)
    );
  END IF;

  RETURN v_order;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2) private.order_chat_author_role(uuid) — TIP 1. Rele DIRÈKTEMAN nan yon
--    policy RLS ("order_chat_messages read", 20260723100000_order_chat.sql:
--    73-74) — lè li bay `NULL` pa erè pou yon admin, policy a senpleman
--    filtre TOUT liy pou li, san okenn erè (endistenkib ak "pa gen aktivite
--    chat"). Sèl definisyon: 20260723100000_order_chat.sql:44.
CREATE OR REPLACE FUNCTION private.order_chat_author_role(_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
BEGIN
  SELECT customer_id INTO v_customer_id FROM public.orders WHERE id = _order_id;
  IF NOT FOUND THEN
    RETURN NULL;
  ELSIF v_customer_id = auth.uid() THEN
    RETURN 'customer';
  ELSIF private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin') THEN
    RETURN 'admin';
  ELSIF EXISTS (
    SELECT 1 FROM public.deliveries de JOIN public.drivers dr ON dr.id = de.driver_id
    WHERE de.order_id = _order_id AND dr.user_id = auth.uid()
  ) THEN
    RETURN 'driver';
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) private.dispute_author_role(disputes) — enpak kaskad (wè nòt anwo a).
--    Sèl definisyon: 20260714131500_disputes.sql:81. Rele pa
--    add_dispute_message_secure/open_dispute_secure/resolve_dispute_secure
--    (menm fichye) ak pa policy RLS sou dispute_messages.
CREATE OR REPLACE FUNCTION private.dispute_author_role(_dispute public.disputes)
RETURNS public.dispute_author_role
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _dispute.customer_id = auth.uid() THEN
    RETURN 'customer';
  ELSIF private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin') THEN
    RETURN 'admin';
  ELSIF EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = _dispute.restaurant_id AND r.owner_id = auth.uid())
     OR EXISTS (SELECT 1 FROM public.restaurant_employees e WHERE e.restaurant_id = _dispute.restaurant_id AND e.user_id = auth.uid()) THEN
    RETURN 'restaurant';
  ELSIF EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = _dispute.driver_id AND d.user_id = auth.uid()) THEN
    RETURN 'driver';
  ELSE
    RETURN NULL;
  END IF;
END;
$$;

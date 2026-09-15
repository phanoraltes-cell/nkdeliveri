-- ===========================================================================
-- REGLEMAN LIVREZON KI ECHWE — kredi pwovizwa, abitraj admin, ak sòti depi
-- `assigned` (odit A3-1)
--
-- ---------------------------------------------------------------------------
-- TWA DEFO KI TRETE ANSANM
--
-- 1) KREDI ENSTANTANE SAN PREV NI RANVÈSMAN
--    `trg_generate_driver_commission_on_delivery_failure` (20260817120000)
--    kredite `wallets.available_balance` yon livrè otomatikman lè
--    `orders.status` vin `delivery_failed`. Okenn prèv retrè pa egzije —
--    « Pran l » se yon senp bouton ki fè yon UPDATE dirèk sou `deliveries`
--    (dashboard.driver.history.tsx:159), san konfimasyon restoran. Epi
--    okenn trigger pa ranvèse kredi sa a: `trg_reverse_commission_on_refund`
--    deklanche SÈLMAN sou (NEW.status='refunded' AND OLD.status='delivered')
--    epi li touche sèlman `entry_type='order_commission'`.
--
--    Chèn ki te posib: pran yon kòmand `ready` -> peze « Pran l » ->
--    siyale yon echèk -> bous kredite, definitivman. Plafon: 20 pri/5min,
--    20 rapò/è.
--
-- 2) DOUB KREDI SOU CHEMEN ONÈT LA
--    `trg_generate_commission_on_delivery` deklanche sou
--    (NEW.status='delivered' AND OLD.status IS DISTINCT FROM 'delivered')
--    epi li kredite livrè a ak `entry_type='order_commission'`. De kle inik
--    pasyèl diferan, donk de liy koegziste. Bouton prensipal ekran admin lan
--    se egzakteman « make livre » (dashboard.admin.delivery-failed.tsx:175).
--    Donk: echèk -> kredi #1; admin make livre -> kredi #2, MENM kous.
--
-- 3) OKENN SÒTI ANT `assigned` AK `picked_up` (A3-1)
--    Livrè a pa ka lage yon kous, `report_delivery_failed_secure` refize
--    depi `assigned`, okenn ekran admin pa vize yon kòmand nan eta sa a.
--    Yon livrè ki tonbe an pàn bloke kòmand lan san sòti.
--
-- Mezire sou pwodiksyon anvan migrasyon sa a:
--   SELECT count(*), sum(net_amount) FROM commission_ledger
--    WHERE entry_type='driver_commission_delivery_failed';   ->  0, 0
-- Donk okenn rekiperasyon done pa nesesè: defo yo latan, pa aktif.
--
-- ---------------------------------------------------------------------------
-- PRENSIP LA: KREDI A VIN PWOVIZWA JISKASKE YON MOUN TRANCHE
--
-- Se menm agiman 20260827130000 pote deja — « a human should look before
-- any balance is adjusted ».
--
--   * Echèk apre retrè  -> kredi nan `pending_balance` (pa depansab)
--   * Echèk AVAN retrè  -> okenn kredi ditou (livrè a pa fè anyen)
--   * Admin tranche ak yon rezon OBLIGATWA, twa isi:
--       'delivered'         -> pwovizwa a ranvèse; chemen nòmal
--                              `order_commission` peye. YON SÈL kredi.
--       'cancelled_paid'    -> pwovizwa a vin disponib
--       'cancelled_unpaid'  -> pwovizwa a ranvèse, zewo
--
-- ---------------------------------------------------------------------------
-- ⚠ DESIZYON PWODWI KI MERITE YON DEZYÈM GADE
--
-- Pousantaj la aplike sou FRÈ LIVREZON BRIT la (jan sa te mande), pa sou pa
-- livrè a. Konsekans aritmetik: si `drivers.commission_rate` yon livrè pi ba
-- pase pousantaj règleman an, yon livrezon ECHWE peye l PLIS pase yon
-- livrezon reyisi.
--
--   fee = 100, commission_rate = 40%, pay_percentage = 50%
--     reyisi -> 40 HTG    |    echwe (peye) -> 50 HTG
--
-- Nou PA plafone an silans — sa ta chanje sa ki te mande. Si se pa sa ki
-- vle, chanje `pay_percentage` oswa mete yon plafon eksplisit nan yon
-- migrasyon apre.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) REGLEMAN VÈSYONE — menm fòm ak `withdrawal_rules`
--
-- Yon TAB APA, pa yon kolòn sou `withdrawal_rules`: sa a pa yon règ retrè,
-- li pa gen dimansyon `role`, epi melanje yo ta fòse yon wòl ki pa vle di
-- anyen isit la. Ekran admin lan montre toude ansanm — se prezantasyon, pa
-- estrikti.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_failure_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pousantaj sou frè livrezon BRIT la (wè avètisman antèt la).
  pay_percentage numeric(6, 2) NOT NULL DEFAULT 50
    CHECK (pay_percentage >= 0 AND pay_percentage <= 100),
  effective_from timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delivery_failure_rules_effective_idx
  ON public.delivery_failure_rules (effective_from DESC);

ALTER TABLE public.delivery_failure_rules ENABLE ROW LEVEL SECURITY;

-- Menm posti ak `withdrawal_rules`: lekti pou tout moun ki konekte. Yon
-- livrè gen dwa wè konbyen yon echèk peye AVAN li aksepte yon kous.
DROP POLICY IF EXISTS "delivery_failure_rules read" ON public.delivery_failure_rules;
CREATE POLICY "delivery_failure_rules read" ON public.delivery_failure_rules
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.delivery_failure_rules FROM PUBLIC, anon;
GRANT SELECT ON public.delivery_failure_rules TO authenticated;

-- Seed 50% — SÈLMAN si tab la vid. Menm rezon ak `withdrawal_rules`: de
-- règ ak menm `effective_from` ta fè « ORDER BY effective_from DESC LIMIT 1 »
-- anbigi, epi montan yon règleman ta depann de yon tiraj osò.
INSERT INTO public.delivery_failure_rules (pay_percentage, notes)
SELECT 50, 'Vèsyon inisyal — defo mande nan odit A3-1.'
WHERE NOT EXISTS (SELECT 1 FROM public.delivery_failure_rules);

-- Règ ki an vigè kounye a. `SECURITY DEFINER` pa nesesè: tab la lizib pou
-- tout moun ki konekte.
CREATE OR REPLACE FUNCTION public.get_delivery_failure_rule()
RETURNS public.delivery_failure_rules
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT * FROM public.delivery_failure_rules
  WHERE effective_from <= now()
  ORDER BY effective_from DESC, created_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_delivery_failure_rule() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_delivery_failure_rule() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) TRAS REGLEMAN AN SOU LIVREZON AN
--
-- Pousantaj la JELE isit la nan moman echèk la, pa li chak fwa. Konsa yon
-- chanjman règ apre pa retwoaktif sou yon dosye ki deja louvri — se sa
-- « yon règleman ki deja fèt kenbe pousantaj ki te aplike a » vle di.
-- ---------------------------------------------------------------------------
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS provisional_pay_percentage numeric(6, 2),
  ADD COLUMN IF NOT EXISTS provisional_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS settlement_outcome text,
  ADD COLUMN IF NOT EXISTS settlement_reason text,
  ADD COLUMN IF NOT EXISTS settled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

ALTER TABLE public.deliveries DROP CONSTRAINT IF EXISTS deliveries_settlement_outcome_check;
ALTER TABLE public.deliveries ADD CONSTRAINT deliveries_settlement_outcome_check
  CHECK (settlement_outcome IS NULL
      OR settlement_outcome IN ('delivered', 'cancelled_paid', 'cancelled_unpaid'));

-- ---------------------------------------------------------------------------
-- 3) NOUVO TIP TRANZAKSYON BOUS
--
-- Lis la reekri kòm yon INYON KONPLÈ. `scripts/check-check-constraint-drift.mjs`
-- bloke nenpòt reekriti ki pèdi yon valè — patwon an deja frape de fwa sou
-- menm kontrent sa a.
-- ---------------------------------------------------------------------------
ALTER TABLE public.wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
ALTER TABLE public.wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN (
    -- Orijinal (20260722100000)
    'commission_credit', 'commission_reversed',
    'payout_sent', 'payout_confirmed', 'payout_reversed',
    'wallet_recomputed',
    -- Sikèl pwovidè (20260730100000)
    'payout_pending', 'payout_provider_confirmed', 'payout_provider_failed',
    -- Wallet kliyan (20260901010000, Tach 1C)
    'topup_credit', 'order_payment_debit', 'order_refund_credit', 'wallet_adjustment',
    -- Retrè pwòp-tèt (20260901080000, Tach 3B)
    'withdrawal_requested', 'withdrawal_processing', 'withdrawal_manual_paid', 'withdrawal_cancelled',
    -- Livrezon ki echwe (migrasyon sa a, odit A3-1)
    'commission_pending', 'commission_pending_reversed', 'commission_pending_settled'
  ));

-- Idanpotans pou ranvèsman yon kredi pwovizwa livrè. Endèks ki egziste a
-- kouvri `(order_id, restaurant_id) WHERE entry_type='reversal'`; kote
-- livrè a pa t kouvri.
CREATE UNIQUE INDEX IF NOT EXISTS commission_ledger_driver_reversal_idx
  ON public.commission_ledger (order_id, driver_id)
  WHERE entry_type = 'reversal' AND driver_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4) KREDI A VIN PWOVIZWA, EPI LI DISPARÈT LÈ PA GEN RETRÈ
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.generate_driver_commission_on_delivery_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delivery public.deliveries;
  v_driver_rate numeric;
  v_pay_pct numeric;
  v_provisional numeric;
  v_ledger_id uuid;
  v_wallet_id uuid;
BEGIN
  SELECT d.* INTO v_delivery
  FROM public.deliveries d
  WHERE d.order_id = NEW.id AND d.driver_id IS NOT NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- OKENN RETRÈ, OKENN KREDI. Se sa ki fè sòti depi `assigned` la san
  -- danje: yon livrè ki lage yon kous anvan li al chèche l pa fè anyen,
  -- donk li pa touche anyen.
  IF v_delivery.picked_up_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT dr.commission_rate INTO v_driver_rate
  FROM public.drivers dr WHERE dr.id = v_delivery.driver_id;

  SELECT r.pay_percentage INTO v_pay_pct FROM public.get_delivery_failure_rule() r;
  v_pay_pct := COALESCE(v_pay_pct, 50);

  v_provisional := ROUND(COALESCE(v_delivery.fee, 0) * v_pay_pct / 100, 2);
  IF v_provisional <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.commission_ledger (
    driver_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount, notes
  )
  VALUES (
    v_delivery.driver_id, NEW.id, 'driver_commission_delivery_failed',
    v_delivery.fee, v_pay_pct, COALESCE(v_delivery.fee, 0) - v_provisional, v_provisional,
    'Kredi pwovizwa — ap tann abitraj admin'
  )
  ON CONFLICT (order_id, driver_id) WHERE entry_type = 'driver_commission_delivery_failed' AND driver_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- `pending_balance`, PA `available_balance`. Epi PA `lifetime_earnings`:
  -- anyen pa antre nan sa yon livrè touche toutbon toutotan yon moun pa
  -- konfime l.
  INSERT INTO public.wallets (driver_id, pending_balance)
  VALUES (v_delivery.driver_id, v_provisional)
  ON CONFLICT (driver_id) DO UPDATE SET
    pending_balance = wallets.pending_balance + v_provisional,
    updated_at = now()
  RETURNING id INTO v_wallet_id;

  INSERT INTO public.wallet_transactions (wallet_id, type, pending_delta, commission_ledger_id, note)
  VALUES (v_wallet_id, 'commission_pending', v_provisional, v_ledger_id,
    'Kredi pwovizwa sou livrezon echwe — kòmand ' || NEW.order_number);

  UPDATE public.deliveries
     SET provisional_pay_percentage = v_pay_pct,
         provisional_amount = v_provisional,
         updated_at = now()
   WHERE id = v_delivery.id;

  PERFORM private.log_audit_event(NULL, NULL, 'commission.pending_created',
    jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id,
      'driver_id', v_delivery.driver_id, 'amount', v_provisional, 'pay_percentage', v_pay_pct));

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.generate_driver_commission_on_delivery_failure() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) RANVÈSMAN OTOMATIK SOU `delivery_failed` -> `delivered`
--
-- Sa a se GAD LA, pa konvenyans. Li deklanche kèlkeswa chemen ki mete
-- `delivered` — RPC règleman an, `update_order_status_secure`, oswa yon
-- patch SQL manyèl. Se li ki garanti YON SÈL kredi: pwovizwa a disparèt,
-- epi `trg_generate_commission_on_delivery` peye `order_commission` la.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.reverse_provisional_on_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.commission_ledger;
  v_delivery public.deliveries;
  v_ledger_id uuid;
  v_wallet_id uuid;
BEGIN
  SELECT * INTO v_entry FROM public.commission_ledger
  WHERE order_id = NEW.id
    AND entry_type = 'driver_commission_delivery_failed'
    AND driver_id IS NOT NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_delivery FROM public.deliveries WHERE order_id = NEW.id;

  -- Ki bous ki kenbe montan an kounye a? Yon règleman `cancelled_paid` deja
  -- deplase l nan `available`; san règleman li toujou nan `pending`. Si nou
  -- te toujou retire nan `pending`, yon kòmand ki pase pa
  -- `cancelled_paid` epi apre `delivered` ta bay yon `pending_balance`
  -- NEGATIF — yon bous ki dwe lajan platfòm lan, san pèsonn pa wè l.
  IF v_delivery.settlement_outcome IN ('cancelled_unpaid', 'delivered') THEN
    RETURN NEW;  -- deja ranvèse
  END IF;

  INSERT INTO public.commission_ledger (
    driver_id, order_id, entry_type, gross_amount, commission_amount, net_amount, notes
  )
  VALUES (
    v_entry.driver_id, NEW.id, 'reversal',
    v_entry.gross_amount, -v_entry.commission_amount, -v_entry.net_amount,
    'Ranvèsman kredi pwovizwa — kòmand lan finalman livre'
  )
  ON CONFLICT (order_id, driver_id) WHERE entry_type = 'reversal' AND driver_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_delivery.settlement_outcome = 'cancelled_paid' THEN
    -- Montan an deja disponib: nou retire l la, epi nan `lifetime_earnings`
    -- tou, paske se la règleman an te mete l.
    UPDATE public.wallets SET
      available_balance = available_balance - v_entry.net_amount,
      lifetime_earnings = lifetime_earnings - v_entry.net_amount,
      updated_at = now()
    WHERE driver_id = v_entry.driver_id
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, note)
    VALUES (v_wallet_id, 'commission_pending_reversed', -v_entry.net_amount, -v_entry.net_amount, v_ledger_id,
      'Kredi ranvèse — kòmand ' || NEW.order_number || ' finalman livre');
  ELSE
    UPDATE public.wallets SET
      pending_balance = pending_balance - v_entry.net_amount,
      updated_at = now()
    WHERE driver_id = v_entry.driver_id
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (wallet_id, type, pending_delta, commission_ledger_id, note)
    VALUES (v_wallet_id, 'commission_pending_reversed', -v_entry.net_amount, v_ledger_id,
      'Kredi pwovizwa ranvèse — kòmand ' || NEW.order_number || ' finalman livre');
  END IF;

  UPDATE public.deliveries SET settlement_outcome = 'delivered', updated_at = now()
   WHERE order_id = NEW.id AND settlement_outcome IS DISTINCT FROM 'delivered';

  PERFORM private.log_audit_event(NULL, NULL, 'commission.pending_reversed',
    jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id,
      'driver_id', v_entry.driver_id, 'amount', v_entry.net_amount, 'reason', 'delivered_after_failure'));

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.reverse_provisional_on_delivered() FROM PUBLIC, anon, authenticated;

-- Kondisyon an LAJ eksprè: `OLD.status IS DISTINCT FROM 'delivered'`, pa
-- `OLD.status = 'delivery_failed'`. Yon admin gen dwa fè
-- `delivery_failed -> cancelled -> delivered`; ak yon kondisyon etwat,
-- dezyèm so a pa t ap deklanche epi livrè a ta kenbe toude kredi yo. Kò
-- fonksyon an sòti touswit lè pa gen okenn kredi pwovizwa, donk yon
-- livrezon nòmal pa peye anyen isit la.
--
-- LÒD DEKLANCHÈ: Postgres kouri AFTER trigger yo nan lòd alfabetik.
--   trg_generate_commission_on_delivery   ('g')
--   trg_reverse_provisional_on_delivered  ('r')
-- Yo endepandan kanmenm — youn touche `available`, lòt la `pending` —
-- men lòd la merite yon nòt paske li pa evidan.
DROP TRIGGER IF EXISTS trg_reverse_provisional_on_delivered ON public.orders;
CREATE TRIGGER trg_reverse_provisional_on_delivered
AFTER UPDATE ON public.orders
FOR EACH ROW WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
EXECUTE FUNCTION private.reverse_provisional_on_delivered();

-- ---------------------------------------------------------------------------
-- 6) ABITRAJ ADMIN — twa sòti, yon rezon OBLIGATWA sou chak
--
-- Rezon an pa yon nòt: si yon livrè konteste yon desizyon apre, se sèl tras
-- ki di poukisa. Li ale nan `deliveries.settlement_reason` EPI nan jounal
-- odit la.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_failed_delivery_secure(
  _order_id uuid,
  _outcome text,
  _reason text
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.orders;
  v_delivery public.deliveries;
  v_entry public.commission_ledger;
  v_reason text;
  v_wallet_id uuid;
  v_ledger_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _outcome NOT IN ('delivered', 'cancelled_paid', 'cancelled_unpaid') THEN
    RAISE EXCEPTION 'Rezilta a pa valid.';
  END IF;

  v_reason := NULLIF(btrim(_reason), '');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Yon rezon obligatwa pou chak desizyon.';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kòmand pa jwenn.';
  END IF;
  IF v_order.status <> 'delivery_failed' THEN
    RAISE EXCEPTION 'Kòmand sa a pa nan eta livrezon echwe.';
  END IF;

  SELECT * INTO v_delivery FROM public.deliveries WHERE order_id = _order_id FOR UPDATE;
  IF FOUND AND v_delivery.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Kòmand sa a deja regle.';
  END IF;

  SELECT * INTO v_entry FROM public.commission_ledger
  WHERE order_id = _order_id
    AND entry_type = 'driver_commission_delivery_failed'
    AND driver_id IS NOT NULL;

  -- --- lajan an ---
  IF _outcome = 'cancelled_paid' AND FOUND THEN
    -- Pwovizwa a vin disponib. Se ISIT LA li antre nan `lifetime_earnings`:
    -- se kounye a li touche toutbon.
    UPDATE public.wallets SET
      pending_balance = pending_balance - v_entry.net_amount,
      available_balance = available_balance + v_entry.net_amount,
      lifetime_earnings = lifetime_earnings + v_entry.net_amount,
      updated_at = now()
    WHERE driver_id = v_entry.driver_id
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (
      wallet_id, type, pending_delta, available_delta, lifetime_delta, commission_ledger_id, created_by, note
    )
    VALUES (
      v_wallet_id, 'commission_pending_settled',
      -v_entry.net_amount, v_entry.net_amount, v_entry.net_amount, v_entry.id, v_user,
      'Abitraj admin — kòmand ' || v_order.order_number || ' : ' || v_reason
    );

  ELSIF _outcome = 'cancelled_unpaid' AND v_entry.id IS NOT NULL THEN
    INSERT INTO public.commission_ledger (
      driver_id, order_id, entry_type, gross_amount, commission_amount, net_amount, notes
    )
    VALUES (
      v_entry.driver_id, _order_id, 'reversal',
      v_entry.gross_amount, -v_entry.commission_amount, -v_entry.net_amount,
      'Abitraj admin — pa peye : ' || v_reason
    )
    ON CONFLICT (order_id, driver_id) WHERE entry_type = 'reversal' AND driver_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_ledger_id;

    IF v_ledger_id IS NOT NULL THEN
      UPDATE public.wallets SET
        pending_balance = pending_balance - v_entry.net_amount,
        updated_at = now()
      WHERE driver_id = v_entry.driver_id
      RETURNING id INTO v_wallet_id;

      INSERT INTO public.wallet_transactions (
        wallet_id, type, pending_delta, commission_ledger_id, created_by, note
      )
      VALUES (
        v_wallet_id, 'commission_pending_reversed', -v_entry.net_amount, v_ledger_id, v_user,
        'Abitraj admin — pa peye : ' || v_reason
      );
    END IF;
  END IF;
  -- `delivered`: nou pa touche lajan an isit la. Chanjman estati a pi ba
  -- deklanche `trg_reverse_provisional_on_delivered` (ki retire pwovizwa a)
  -- epi `trg_generate_commission_on_delivery` (ki peye `order_commission`).
  -- YON SÈL kredi, epi gad la travay menm si yon lòt chemen mete
  -- `delivered`.

  -- --- tras la ---
  UPDATE public.deliveries
     SET settlement_outcome = _outcome,
         settlement_reason = v_reason,
         settled_by = v_user,
         settled_at = now(),
         updated_at = now()
   WHERE order_id = _order_id
  RETURNING * INTO v_delivery;

  PERFORM private.log_audit_event(v_user, 'admin', 'delivery.settled',
    jsonb_build_object('order_id', _order_id, 'outcome', _outcome, 'reason', v_reason,
      'driver_id', v_entry.driver_id, 'amount', v_entry.net_amount,
      'pay_percentage', v_delivery.provisional_pay_percentage));

  -- --- estati kòmand lan ---
  UPDATE public.orders
     SET status = CASE WHEN _outcome = 'delivered' THEN 'delivered'::public.order_status
                       ELSE 'cancelled'::public.order_status END,
         status_history = status_history || jsonb_build_object(
           'from', v_order.status,
           'to', CASE WHEN _outcome = 'delivered' THEN 'delivered' ELSE 'cancelled' END,
           'by', v_user, 'at', now(), 'reason', v_reason
         ),
         updated_at = now()
   WHERE id = _order_id;

  RETURN v_delivery;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_failed_delivery_secure(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_failed_delivery_secure(uuid, text, text) TO authenticated;


-- ---------------------------------------------------------------------------
-- 7) SÒTI DEPI `assigned` — A3-1
--
-- Lis tranzisyon an vin gen (`assigned` -> `delivery_failed`) ak
-- (`en_route_pickup` -> `delivery_failed`). Rès fonksyon an repwodwi
-- EGZAKTEMAN jan li te ye nan 20260821090000 — sèl lis la chanje.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.protect_delivery_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_is_assigned_driver boolean;
BEGIN
  v_is_admin := private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin');

  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only an admin can reassign a delivery' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_admin THEN
    IF NEW.order_id IS DISTINCT FROM OLD.order_id THEN
      RAISE EXCEPTION 'Cannot change order_id' USING ERRCODE = '42501';
    END IF;
    IF NEW.fee IS DISTINCT FROM OLD.fee THEN
      RAISE EXCEPTION 'Cannot change fee' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_is_assigned_driver := EXISTS (
      SELECT 1 FROM public.drivers d WHERE d.id = OLD.driver_id AND d.user_id = auth.uid()
    );
    IF NOT (v_is_admin OR v_is_assigned_driver) THEN
      RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
    END IF;
    IF NOT v_is_admin AND (OLD.status, NEW.status) NOT IN (
      ('assigned', 'en_route_pickup'), ('assigned', 'picked_up'),
      ('en_route_pickup', 'picked_up'),
      ('picked_up', 'en_route_dropoff'), ('picked_up', 'delivered'),
      ('en_route_dropoff', 'delivered'),
      ('picked_up', 'delivery_failed'), ('en_route_dropoff', 'delivery_failed'),
        ('assigned', 'delivery_failed'), ('en_route_pickup', 'delivery_failed')
    ) THEN
      RAISE EXCEPTION 'Illegal delivery status transition: % -> %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'picked_up' AND OLD.picked_up_at IS NULL THEN
      NEW.picked_up_at := now();
    END IF;
    IF NEW.status = 'delivered' THEN
      NEW.delivered_at := now();
    END IF;

    IF NEW.status IN ('delivered', 'cancelled', 'delivery_failed') THEN
      DELETE FROM public.customer_delivery_locations WHERE delivery_id = NEW.id;

      -- Security fix (20260821090000): capture dispute evidence BEFORE
      -- clearing the live position — see migration header. Skipped only
      -- when there was never a position to capture in the first place
      -- (e.g. the driver never shared GPS on this delivery at all).
      IF NEW.driver_lat IS NOT NULL OR NEW.driver_lng IS NOT NULL THEN
        INSERT INTO public.delivery_proof (delivery_id, final_driver_lat, final_driver_lng, final_location_at, final_status)
        VALUES (NEW.id, NEW.driver_lat, NEW.driver_lng, NEW.location_updated_at, NEW.status::text)
        ON CONFLICT (delivery_id) DO UPDATE SET
          final_driver_lat = EXCLUDED.final_driver_lat,
          final_driver_lng = EXCLUDED.final_driver_lng,
          final_location_at = EXCLUDED.final_location_at,
          final_status = EXCLUDED.final_status;
      END IF;

      NEW.driver_lat := NULL;
      NEW.driver_lng := NULL;
      NEW.driver_heading := NULL;
      NEW.location_updated_at := NULL;
    END IF;

    UPDATE public.orders o SET
      status = CASE NEW.status
        WHEN 'picked_up' THEN 'picked_up'::public.order_status
        WHEN 'delivered' THEN 'delivered'::public.order_status
        WHEN 'delivery_failed' THEN 'delivery_failed'::public.order_status
        ELSE o.status
      END,
      delivery_failed_at = CASE WHEN NEW.status = 'delivery_failed' THEN now() ELSE o.delivery_failed_at END,
      status_history = o.status_history || jsonb_build_object(
        'from', o.status, 'to', NEW.status, 'by', auth.uid(), 'at', now()
      ),
      updated_at = now()
    WHERE o.id = NEW.order_id
      AND NEW.status IN ('picked_up', 'delivered', 'delivery_failed');
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 8) SIYALE YON ECHÈK DEPI AVAN RETRÈ A — A3-1
--
-- Nouvo rezon `driver_unavailable`, epi eta `assigned` / `en_route_pickup`
-- aksepte. Rès fonksyon an repwodwi jan li te ye nan 20260830180000.
--
-- Rezon an mare ak kote livrezon an rive: yon livrè ki poko al chèche
-- kòmand lan pa ka di kliyan an pa t la. Sa anpeche yon echèk avan retrè
-- pran yon rezon ki ta sanble yon livrezon ki eseye.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_delivery_failed_secure(
  _order_id uuid,
  _reason text,
  _comment text DEFAULT NULL
)
RETURNS public.deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_delivery public.deliveries;
  v_is_admin boolean;
  v_is_assigned_driver boolean;
  v_comment text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.check_rate_limit_secure('report_delivery_failed', 20, 3600) THEN
    RAISE EXCEPTION 'Twòp rapò nan yon ti tan. Tanpri eseye ankò pita.' USING ERRCODE = '42901';
  END IF;

  IF _reason NOT IN ('customer_unavailable', 'address_not_found', 'zone_inaccessible', 'driver_unavailable', 'other') THEN
    RAISE EXCEPTION 'Rezon an pa valid.';
  END IF;
  v_comment := NULLIF(btrim(_comment), '');
  IF _reason = 'other' AND v_comment IS NULL THEN
    RAISE EXCEPTION 'Tanpri esplike rezon an lè w chwazi "lòt".';
  END IF;

  SELECT * INTO v_delivery FROM public.deliveries WHERE order_id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Livrezon pa jwenn.';
  END IF;

  v_is_admin := private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin');
  v_is_assigned_driver := EXISTS (
    SELECT 1 FROM public.drivers d WHERE d.id = v_delivery.driver_id AND d.user_id = v_user
  );
  IF NOT (v_is_admin OR v_is_assigned_driver) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- A3-1: eta AVAN retrè yo aksepte kounye a. Se sa ki bay yon livrè ki
  -- tonbe an pàn yon sòti — anvan, yon kòmand nan `assigned` pa t gen okenn.
  IF v_delivery.status NOT IN ('assigned', 'en_route_pickup', 'picked_up', 'en_route_dropoff') THEN
    RAISE EXCEPTION 'Ou pa ka siyale yon echèk livrezon nan eta sa a.';
  END IF;

  -- Rezon an dwe kadre ak kote livrezon an rive. Yon livrè ki poko al chèche
  -- kòmand lan pa ka di kliyan an pa t la — li pa t janm ale. Epi yon livrè
  -- ki deja gen manje a nan men l pa ka di li endisponib: li dwe di sa ki
  -- pase ak manje a.
  IF v_delivery.picked_up_at IS NULL AND _reason <> 'driver_unavailable' THEN
    RAISE EXCEPTION 'Anvan ou pran kòmand lan, sèl rezon an se ou pa disponib.';
  END IF;
  IF v_delivery.picked_up_at IS NOT NULL AND _reason = 'driver_unavailable' THEN
    RAISE EXCEPTION 'Ou deja pran kòmand lan — chwazi yon rezon ki di sa ki pase ak li.';
  END IF;

  UPDATE public.deliveries
     SET status = 'delivery_failed',
         failure_reason = _reason,
         failure_comment = v_comment,
         updated_at = now()
   WHERE id = v_delivery.id
   RETURNING * INTO v_delivery;

  PERFORM private.log_audit_event(v_user, CASE WHEN v_is_admin THEN 'admin' ELSE 'driver' END,
    'delivery.failed', jsonb_build_object('order_id', _order_id, 'delivery_id', v_delivery.id, 'reason', _reason));

  INSERT INTO public.notifications (user_id, type, category, title, body, data)
  SELECT o.customer_id, 'order_status_changed', 'order', 'Nou pa t ka livre kòmand ou a',
    'Nou pa t ka livre kòmand ' || o.order_number || '. Manje a ap tann ou nan biwo nou an pou 2 èdtan.',
    jsonb_build_object('order_id', o.id, 'status', 'delivery_failed')
  FROM public.orders o WHERE o.id = _order_id;

  PERFORM private.notify_secure(
    ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
    'delivery_failed', 'order', 'Yon livrezon echwe',
    'Livrezon pou kòmand ' || (SELECT order_number FROM public.orders WHERE id = _order_id) || ' echwe — rezon: ' || _reason || '.',
    jsonb_build_object('order_id', _order_id, 'delivery_id', v_delivery.id, 'reason', _reason)
  );

  RETURN v_delivery;
END;
$$;

COMMIT;

-- ===========================================================================
-- ROLLBACK — 20260915000000_failed_delivery_settlement.sql
--
-- ⚠ PA KOURI FICHYE SA A NAN YON DEPLWAMAN NÒMAL.
--
-- ⚠⚠ LI SA A ANVAN: rollback la remete KREDI ENSTANTANE a, ki se defo
--    sekirite migrasyon an te fèt pou fèmen. Apre ou kouri l, yon livrè ka
--    ankò pran yon kòmand, peze « Pran l », siyale yon echèk, epi wè bous
--    li kredite definitivman — san okenn prèv ni ranvèsman. Pa kouri l sof
--    si ou gen yon rezon ki pi grav pase sa.
--
-- SA LI PA FÈ: li PA efase `delivery_failure_rules` ni kolòn règleman yo
-- sou `deliveries`. Yon `DROP` la ta detwi tras chak desizyon admin ak
-- rezon yo — egzakteman sa ki sèvi si yon livrè konteste. Yo rete; yo jis
-- sispann alimante.
--
-- SA POU FÈ AVAN: si gen kredi pwovizwa ki poko regle, deside sa pou fè ak
-- yo ALAMEN anvan. Rekèt la:
--
--   SELECT d.order_id, d.provisional_amount, d.provisional_pay_percentage,
--          w.driver_id, w.pending_balance
--   FROM public.deliveries d
--   JOIN public.wallets w ON w.driver_id = d.driver_id
--   WHERE d.provisional_amount IS NOT NULL AND d.settled_at IS NULL;
--
-- Chak ranje se lajan ki nan `pending_balance` yon livrè epi ki pral rete
-- la pou tout tan si ou retire mekanis règleman an.
-- ===========================================================================

BEGIN;

-- 1) Retire ranvèsman otomatik la.
DROP TRIGGER IF EXISTS trg_reverse_provisional_on_delivered ON public.orders;
DROP FUNCTION IF EXISTS private.reverse_provisional_on_delivered();

-- 2) Retire abitraj admin lan.
DROP FUNCTION IF EXISTS public.settle_failed_delivery_secure(uuid, text, text);

-- 3) Remete kredi otomatik la nan `available_balance` — vèsyon
--    20260817120000 la, jan li te ye. Wè avètisman antèt la.
CREATE OR REPLACE FUNCTION private.generate_driver_commission_on_delivery_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_driver_rate numeric;
  v_fee numeric;
  v_driver_net numeric;
  v_driver_commission numeric;
  v_ledger_id uuid;
  v_wallet_id uuid;
BEGIN
  SELECT dr.id, dr.commission_rate, d.fee INTO v_driver_id, v_driver_rate, v_fee
  FROM public.deliveries d JOIN public.drivers dr ON dr.id = d.driver_id
  WHERE d.order_id = NEW.id AND d.driver_id IS NOT NULL;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_driver_net := ROUND(v_fee * v_driver_rate / 100, 2);
  v_driver_commission := v_fee - v_driver_net;

  INSERT INTO public.commission_ledger (driver_id, order_id, entry_type, gross_amount, commission_rate, commission_amount, net_amount)
  VALUES (v_driver_id, NEW.id, 'driver_commission_delivery_failed', v_fee, v_driver_rate, v_driver_commission, v_driver_net)
  ON CONFLICT (order_id, driver_id) WHERE entry_type = 'driver_commission_delivery_failed' AND driver_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_ledger_id;

  IF v_ledger_id IS NOT NULL THEN
    INSERT INTO public.wallets (driver_id, available_balance, lifetime_earnings)
    VALUES (v_driver_id, v_driver_net, v_driver_net)
    ON CONFLICT (driver_id) DO UPDATE SET
      available_balance = wallets.available_balance + v_driver_net,
      lifetime_earnings = wallets.lifetime_earnings + v_driver_net,
      updated_at = now()
    RETURNING id INTO v_wallet_id;

    INSERT INTO public.wallet_transactions (wallet_id, type, available_delta, lifetime_delta, commission_ledger_id, note)
    VALUES (v_wallet_id, 'commission_credit', v_driver_net, v_driver_net, v_ledger_id,
      'Komisyon sou livrezon echwe — kòmand ' || NEW.order_number);

    PERFORM private.log_audit_event(NULL, NULL, 'commission.created',
      jsonb_build_object('commission_ledger_id', v_ledger_id, 'order_id', NEW.id, 'driver_id', v_driver_id,
        'net_amount', v_driver_net, 'entry_type', 'driver_commission_delivery_failed'));
    PERFORM private.log_audit_event(NULL, NULL, 'wallet.credited',
      jsonb_build_object('wallet_id', v_wallet_id, 'driver_id', v_driver_id, 'amount', v_driver_net));
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.generate_driver_commission_on_delivery_failure() FROM PUBLIC, anon, authenticated;

COMMIT;

-- ===========================================================================
-- NÒT: seksyon 7 ak 8 migrasyon an (sòti depi `assigned`) PA defèt isit la.
--
-- Yo pa gen rapò ak lajan: yo jis bay yon livrè ki tonbe an pàn yon fason
-- pou l di sa. Defèt yo ta remete kòmand yo bloke san sòti — yon rekil ki
-- pa gen okenn rapò ak rezon ki ta fè yon moun kouri yon rollback.
--
-- Si ou VLE defèt yo kanmenm, li migrasyon 20260821090000 ak 20260830180000
-- epi remete de fonksyon yo jan yo te ye — men mande tèt ou poukisa anvan.
-- ===========================================================================

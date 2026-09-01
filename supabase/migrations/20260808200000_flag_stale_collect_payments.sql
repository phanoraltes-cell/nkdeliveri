-- Backend chain-coherence remediation (docs/archive/misc/BACKEND_PAYMENT_REMEDIATION.md).
--
-- Confirmed against real production data, not assumed: every automatic
-- collect payment attempt ever made in this project (18/18 as of this
-- audit) is still `payment_transactions.status = 'pending'` — zero have
-- ever resolved to 'paid' or 'failed'. The daily reconciliation cron
-- (plop-reconcile.server.ts) IS running correctly (verified via
-- plop_api_logs: clean 200 responses every day since 2026-08-05) and PLOP
-- itself correctly reports `trans_status:"no"` for all of them (verified
-- via the logged response bodies) — these are genuinely abandoned
-- checkout attempts, not a reconciliation bug. The real gap: once a
-- transaction crosses the 3-day "needs manual review" threshold
-- (plop-reconcile.server.ts's own `STALE_REVIEW_AFTER_MS`), the ONLY
-- signal is a `console.error` — invisible to anyone without direct Vercel
-- log access. No admin notification, no push, nothing in the admin
-- dashboard highlights it as needing attention. 16 of the 18 transactions
-- in production are already past this threshold today.
--
-- This migration adds the missing escalation path, following this
-- project's own established notify_secure + push-sibling convention
-- ([[project_notification_push_convention]]) — the same pattern
-- create_collect_payment_secure/complete_collect_payment_secure already
-- use for their own admin alerts.

-- ---------------------------------------------------------------------------
-- 1) Tracking column — so a stuck transaction is only ever flagged ONCE,
-- not re-notified every single day for as long as it stays pending.
-- Nullable, no default: NULL means "never flagged".
ALTER TABLE public.payment_transactions
  ADD COLUMN stale_flagged_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2) flag_stale_collect_payment_secure — called once a day by
-- plop-reconcile.server.ts (service_role, cron context — no user session,
-- hence no rate-limit check here, unlike the customer-facing RPCs in this
-- same chain) for every candidate past the stale threshold. Idempotent:
-- the UPDATE only ever matches a row that is still `pending` AND not yet
-- flagged, so calling this daily for the same stuck transaction is a safe
-- no-op after the first call — `just_flagged` tells the TypeScript caller
-- whether to actually send a push this time (SQL has no way to reach a
-- push API itself; this is the same split every other RPC in this chain
-- already follows — SQL owns the in-app bell via notify_secure, the
-- caller owns the push).
CREATE FUNCTION public.flag_stale_collect_payment_secure(_external_reference text)
RETURNS TABLE (
  just_flagged boolean,
  transaction_id uuid,
  order_id uuid,
  payment_id uuid,
  amount numeric,
  payment_method_requested text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.payment_transactions;
  v_just_flagged boolean := false;
BEGIN
  UPDATE public.payment_transactions SET
    stale_flagged_at = now()
  WHERE external_reference = _external_reference
    AND status = 'pending'
    AND stale_flagged_at IS NULL
  RETURNING * INTO v_row;

  IF FOUND THEN
    v_just_flagged := true;
    PERFORM private.notify_secure(
      ARRAY(SELECT ur.user_id FROM public.user_roles ur WHERE ur.role IN ('admin', 'super_admin')),
      'collect_payment_stale', 'payment',
      'Peman otomatik bloke depi plizyè jou',
      'Yon tantativ peman ' || v_row.amount || ' HTG rete "an atant" depi plis pase 3 jou san rezoud — verifye li manyèlman.',
      jsonb_build_object('payment_id', v_row.payment_id, 'order_id', v_row.order_id, 'external_reference', _external_reference)
    );
  ELSE
    -- Already flagged, no longer pending, or an unknown reference —
    -- return whatever the row currently looks like (if it exists at all)
    -- so the caller still has enough context to skip cleanly, never an
    -- exception for what is, from the cron's perspective, a completely
    -- ordinary "nothing new to do" outcome.
    SELECT * INTO v_row FROM public.payment_transactions WHERE external_reference = _external_reference;
  END IF;

  RETURN QUERY SELECT
    v_just_flagged,
    v_row.id,
    v_row.order_id,
    v_row.payment_id,
    v_row.amount,
    v_row.payment_method_requested;
END;
$$;
REVOKE ALL ON FUNCTION public.flag_stale_collect_payment_secure(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_stale_collect_payment_secure(text) TO service_role;

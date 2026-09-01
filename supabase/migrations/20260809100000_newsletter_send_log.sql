-- Newsletter remediation, Phase 1 (docs/archive/audits/NEWSLETTER_EMAIL_REMEDIATION_AUDIT.md
-- § 5, Phase 1): the admin "Voye imèl an mas" broadcast collapses every
-- per-recipient failure (network error, Resend 4xx/5xx, rate limit...) into
-- a bare `failed++` with zero detail kept anywhere -- making the reported
-- send failures undiagnosable without first adding real observability.
-- This migration is purely additive (new table only) and, on its own,
-- fixes nothing -- see send-newsletter.functions.ts for the matching code
-- change that actually writes to it.
--
-- Schema matrix-matched, where it makes sense, to the existing
-- provider-call-log convention (plop_api_logs/stripe_api_logs,
-- 20260804120000_plop_api_logs.sql) -- one row per outbound API call,
-- append-only, admin-read-only, service_role-write-only. Denormalizes
-- broadcast_id/subject onto every row (rather than a separate parent
-- "broadcasts" table) so a single SELECT already tells the full story of
-- one send attempt without a join -- there is no other consumer of a
-- broadcast-level summary today.

CREATE TABLE public.newsletter_send_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id uuid NOT NULL,
  subject text NOT NULL,
  recipient_email text NOT NULL,
  success boolean NOT NULL,
  http_status int,
  error text,
  duration_ms int NOT NULL,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX newsletter_send_log_broadcast_id_idx ON public.newsletter_send_log(broadcast_id);
CREATE INDEX newsletter_send_log_created_at_idx ON public.newsletter_send_log(created_at DESC);
-- Partial index: the diagnostic-relevant query is almost always "show me
-- the failures", same reasoning as payment_transactions' stale-flag index.
CREATE INDEX newsletter_send_log_failed_idx ON public.newsletter_send_log(created_at DESC)
  WHERE success = false;

ALTER TABLE public.newsletter_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "newsletter_send_log admin read" ON public.newsletter_send_log FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.newsletter_send_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.newsletter_send_log TO authenticated;
GRANT SELECT, INSERT ON public.newsletter_send_log TO service_role;
-- No UPDATE/DELETE grant to service_role -- the triggers below reject it
-- anyway, same append-only reasoning as every other API-call audit table.

-- Reuses the existing append-only guard (private.prevent_log_mutation(),
-- first defined by 20260730130000_moncash_financial_audit_log.sql) --
-- never a second copy of the same trigger logic for a new audit table.
CREATE TRIGGER newsletter_send_log_no_update_delete
  BEFORE UPDATE OR DELETE ON public.newsletter_send_log
  FOR EACH ROW EXECUTE FUNCTION private.prevent_log_mutation();

CREATE TRIGGER newsletter_send_log_no_truncate
  BEFORE TRUNCATE ON public.newsletter_send_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_log_mutation();

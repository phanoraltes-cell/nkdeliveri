-- Complete financial audit trail for the MonCash connector
-- (moncash-client.server.ts): every outbound API call attempt — request,
-- response, error, latency, MonCash reference — journaled to a table
-- that cannot be updated, deleted, or truncated by ANY role, including
-- service_role. Combined with the existing moncash_webhook_events table
-- (inbound side, already append-only in practice, now enforced the same
-- way here), this is the full request+response+webhook audit trail for
-- every MonCash interaction this app makes. See
-- docs/MONCASH_FINANCIAL_AUDIT.md.

-- ---------------------------------------------------------------------------
-- 1) moncash_api_logs — one row per HTTP attempt (including retries) made
-- by moncash-client.server.ts: /oauth/token, /v1/CreatePayment,
-- /v1/RetrieveOrderPayment, /v1/RetrieveTransactionPayment.
--
-- request_summary/response_summary are deliberately NOT the raw
-- request/response — moncash-client.server.ts builds them by hand per
-- endpoint, allowlisting only fields already known to be safe (never an
-- Authorization header, never the OAuth access_token, payment tokens
-- truncated to a few chars). This is an audit log an admin can read
-- (RLS below), so it must never become a second place secrets leak from.
CREATE TABLE public.moncash_api_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  attempt int NOT NULL DEFAULT 1,
  http_status int,
  duration_ms int NOT NULL,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb,
  error text,
  is_timeout boolean NOT NULL DEFAULT false,
  transaction_reference text,
  provider_transaction_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moncash_api_logs_created_at_idx ON public.moncash_api_logs(created_at DESC);
CREATE INDEX moncash_api_logs_transaction_reference_idx ON public.moncash_api_logs(transaction_reference);
CREATE INDEX moncash_api_logs_endpoint_idx ON public.moncash_api_logs(endpoint);

ALTER TABLE public.moncash_api_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moncash_api_logs admin read" ON public.moncash_api_logs FOR SELECT TO authenticated
  USING (private.has_role(auth.uid(), 'admin') OR private.has_role(auth.uid(), 'super_admin'));
REVOKE ALL ON public.moncash_api_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.moncash_api_logs TO authenticated;
GRANT SELECT, INSERT ON public.moncash_api_logs TO service_role;
-- No UPDATE/DELETE grant to service_role either -- the trigger below
-- would reject it anyway, but there is no reason to even offer the
-- privilege for a table that must never be mutated after insert.

-- ---------------------------------------------------------------------------
-- 2) Append-only enforcement, at the database level, for every role.
-- REVOKE/GRANT (above) is a *privilege* boundary -- it stops ordinary
-- clients, but service_role has near-full privileges by default in this
-- project (see every `GRANT ALL ... TO service_role` elsewhere) and a
-- future bug or admin action using supabaseAdmin could otherwise still
-- delete rows. A BEFORE trigger has no such escape hatch short of a
-- superuser explicitly disabling it -- this is what actually makes "ne
-- jamais supprimer les logs" a guarantee instead of a convention.
CREATE OR REPLACE FUNCTION private.prevent_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Jounal odit sa a se append-only — % pa pèmèt sou %.%', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER moncash_api_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON public.moncash_api_logs
  FOR EACH ROW EXECUTE FUNCTION private.prevent_log_mutation();

CREATE TRIGGER moncash_api_logs_no_truncate
  BEFORE TRUNCATE ON public.moncash_api_logs
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_log_mutation();

-- moncash_webhook_events (20260730100000_moncash_webhook_payout_lifecycle.sql)
-- legitimately needs UPDATE (status: processing -> processed/failed), so
-- only DELETE/TRUNCATE are blocked there, not UPDATE.
CREATE TRIGGER moncash_webhook_events_no_delete
  BEFORE DELETE ON public.moncash_webhook_events
  FOR EACH ROW EXECUTE FUNCTION private.prevent_log_mutation();

CREATE TRIGGER moncash_webhook_events_no_truncate
  BEFORE TRUNCATE ON public.moncash_webhook_events
  FOR EACH STATEMENT EXECUTE FUNCTION private.prevent_log_mutation();

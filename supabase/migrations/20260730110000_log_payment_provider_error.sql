-- Admin MonCash dashboard needs somewhere to show "erreurs": today the
-- only reachable provider-payout failure path is synchronous (a
-- disbursement attempt fails inside initiate-provider-payout.functions.ts
-- before any payout row ever exists — see moncash-provider.server.ts),
-- so nothing about it is persisted anywhere except an ephemeral client
-- toast. This RPC gives that path a durable, admin-visible record,
-- reusing the existing audit_log table (no new schema) — the same table
-- fail_pending_payout_secure already writes to via 'payout.provider_failed'
-- for the webhook-driven failure path, so the admin dashboard can show
-- both kinds of failure from one source.
CREATE FUNCTION public.log_payment_provider_error_secure(
  _provider_code text,
  _method text,
  _restaurant_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _amount numeric DEFAULT NULL,
  _error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payout.provider_attempt_failed',
    jsonb_build_object(
      'provider_code', _provider_code,
      'method', _method,
      'restaurant_id', _restaurant_id,
      'driver_id', _driver_id,
      'amount', _amount,
      'error', _error
    ));
END;
$$;
REVOKE ALL ON FUNCTION public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_payment_provider_error_secure(text, text, uuid, uuid, numeric, text) TO authenticated;

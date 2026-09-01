-- Payment Provider Hardening — Phase 2. A new, additive table making the
-- backend the sole source of truth for checkout payment-method
-- availability. Deliberately NOT a modification of the existing
-- `payment_providers` table (code/label/is_active/created_at, 3 rows:
-- manual/moncash_api/natcash_api) — that table gates which *execution
-- engine* handles a payout (décaissement), a different concept from
-- which *checkout method* (kach/moncash/natcash/moncash_auto) a customer
-- may select. Conflating the two would mean a decaissement-gating change
-- accidentally affecting checkout, or vice versa — see
-- docs/archive/payments/PAYMENT_PROVIDER_HARDENING_PHASE0_AUDIT.md § 1 for the full
-- reasoning. Nothing about `payment_providers`, décaissement RPCs, or
-- any other existing object is touched by this migration.

CREATE TABLE public.payment_provider_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  visible boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  default_provider boolean NOT NULL DEFAULT false,
  maintenance_message text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one row may be the default checkout selection — a partial
-- unique index enforces this at the database level rather than trusting
-- every future UPDATE to remember to unset the previous default.
CREATE UNIQUE INDEX payment_provider_settings_single_default_idx
  ON public.payment_provider_settings (default_provider)
  WHERE default_provider = true;

ALTER TABLE public.payment_provider_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_provider_settings FROM PUBLIC, anon;

-- Public read, explicitly required: checkout is browsable before login
-- (create_order_secure is what actually requires auth, not viewing the
-- page or its payment methods) — matches the existing pattern for
-- `restaurants`/`products` (publicly readable, admin-only write).
CREATE POLICY "payment_provider_settings public read" ON public.payment_provider_settings
  FOR SELECT TO anon, authenticated USING (true);
GRANT SELECT ON public.payment_provider_settings TO anon, authenticated;
GRANT ALL ON public.payment_provider_settings TO service_role;

-- ---------------------------------------------------------------------------
-- Seed — Phase 3. Cash is the safe, always-available default; MonCash
-- Automatik starts disabled (its env vars are absent from Vercel
-- Production as of this writing — see docs/archive/audits/DEPLOYMENT_REPORT.md) with the
-- same maintenance message already shown by the frontend-only measure in
-- payment-method-availability.ts, now becoming the actual source of truth.
INSERT INTO public.payment_provider_settings (provider, visible, enabled, default_provider, maintenance_message) VALUES
  ('kach', true, true, true, NULL),
  ('natcash', true, true, false, NULL),
  ('moncash', true, true, false, NULL),
  ('moncash_auto', true, false, false, 'MonCash Automatik ap retounen byento.');

-- ---------------------------------------------------------------------------
-- update_payment_provider_setting_secure — the *only* write path (no
-- direct client UPDATE grant on the table, matches this codebase's
-- established convention of RPC-gated mutation everywhere else). Every
-- parameter besides `_provider` defaults to NULL, meaning "leave this
-- field unchanged" — to explicitly clear `maintenance_message`, pass an
-- empty string (turned into NULL via NULLIF), not NULL itself, since NULL
-- is already claimed to mean "no change requested" for that field.
CREATE FUNCTION public.update_payment_provider_setting_secure(
  _provider text,
  _visible boolean DEFAULT NULL,
  _enabled boolean DEFAULT NULL,
  _maintenance_message text DEFAULT NULL,
  _set_as_default boolean DEFAULT NULL
)
RETURNS public.payment_provider_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payment_provider_settings;
BEGIN
  IF NOT (private.has_role(v_user, 'admin') OR private.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  -- Unset any existing default *before* the main UPDATE below, so a
  -- caller can move the default from one provider to another in a
  -- single RPC call without ever hitting the partial unique index twice
  -- for the same provider.
  IF _set_as_default IS TRUE THEN
    UPDATE public.payment_provider_settings
    SET default_provider = false, updated_by = v_user, updated_at = now()
    WHERE default_provider = true AND provider <> _provider;
  END IF;

  UPDATE public.payment_provider_settings SET
    visible = COALESCE(_visible, visible),
    enabled = COALESCE(_enabled, enabled),
    maintenance_message = CASE
      WHEN _maintenance_message IS NULL THEN maintenance_message
      ELSE NULLIF(_maintenance_message, '')
    END,
    default_provider = COALESCE(_set_as_default, default_provider),
    updated_by = v_user,
    updated_at = now()
  WHERE provider = _provider
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown payment provider: %', _provider USING ERRCODE = 'P0002';
  END IF;

  PERFORM private.log_audit_event(v_user, 'admin', 'payment_provider_setting.updated',
    jsonb_build_object(
      'provider', _provider,
      'visible', v_row.visible,
      'enabled', v_row.enabled,
      'default_provider', v_row.default_provider,
      'maintenance_message', v_row.maintenance_message
    ));

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_payment_provider_setting_secure(text, boolean, boolean, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_payment_provider_setting_secure(text, boolean, boolean, text, boolean) TO authenticated;

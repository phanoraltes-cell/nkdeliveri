-- SECURITY FIX — driver location retained indefinitely on `deliveries`,
-- readable by the customer forever.
--
-- Found during pre-inspection for the driver-compliance/map chantier
-- (Étape 1 §0 audit, requested explicitly before any new feature work).
--
-- `private.protect_delivery_status_transition()` already revokes GPS
-- sharing on a terminal transition (delivered/cancelled/delivery_failed)
-- by deleting the row in `customer_delivery_locations` — but that table
-- only ever held the CUSTOMER's own shared position. The DRIVER's position
-- lives directly on `deliveries.driver_lat/driver_lng/driver_heading/
-- location_updated_at`, and nothing ever cleared it. Combined with the
-- "deliveries read" RLS policy (20260721120000, still live, unchanged by
-- this migration), whose customer clause is `o.customer_id = auth.uid()`
-- with no status/time bound, a customer can read the driver's last known
-- position for any of their own orders indefinitely.
--
-- REVISION (owner review): nulling the live columns outright would also
-- destroy the only record of where the driver actually was at the moment
-- a delivery ended — exactly the evidence `dashboard.admin.delivery-failed.tsx`
-- needs to arbitrate a "the driver says he came, the customer says he
-- never did" dispute. Fix now captures a final snapshot into a NEW,
-- admin-only table (`delivery_proof`) in the same trigger, immediately
-- before nulling the live columns — same event, same transaction, no
-- window where the data exists nowhere.
--
-- Table vs. column-level access control (why a separate table, not just
-- REVOKE SELECT on specific columns of `deliveries`): this app has no
-- distinct Postgres role per app-role (driver/customer/restaurant/admin
-- all connect as the single `authenticated` role; "admin" is an
-- `app_role` value checked via `has_role()` inside RLS, not a database
-- role) — so a column-level GRANT/REVOKE, which only operates per
-- Postgres role, cannot express "admin can read this column, customer on
-- the same role cannot". Only a separate table with its own RLS policy
-- (evaluated per-ROW via `has_role(auth.uid(), ...)`, exactly like every
-- other admin-only table in this project — audit_log, sponsored_placement_
-- events) can express that. Matches audit_log's own precedent closely:
-- write-only via a SECURITY DEFINER function (here, the trigger itself),
-- no direct INSERT grant to any role, admin-only SELECT policy.
--
-- Captured for all three terminal states (delivered/cancelled/
-- delivery_failed), not just delivered/delivery_failed as first proposed —
-- a cancellation can itself be the subject of a dispute ("the driver was
-- never actually there, that's why it got cancelled"), and capturing
-- unconditionally for every terminal transition is no more code than
-- special-casing two of the three.
--
-- Retention for ABANDONED deliveries (a driver goes dark and the delivery
-- never reaches a terminal status at all, so this trigger never fires):
-- deliberately NOT handled here. It's folded into the same daily
-- compliance job being built for driver permit expiry
-- (private.run_driver_compliance_daily_secure(), next migration in this
-- chantier) — one scheduled job, one place that sweeps time-based cleanup,
-- rather than a second independent pg_cron entry for the same category of
-- concern.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS private.protect_delivery_status_transition();
--   -- Re-apply the immediately-prior CREATE OR REPLACE verbatim, from
--   -- 20260817120000_nkd016_delivery_failed.sql:232-306.
--   DROP TABLE IF EXISTS public.delivery_proof;
--
-- Wrapped BEGIN...COMMIT (A11).
BEGIN;

-- ---------------------------------------------------------------------------
-- 1) delivery_proof — admin-only. No direct write grant to any role; the
--    only writer is the SECURITY DEFINER trigger below (executes as the
--    function owner, bypasses this table's RLS/grants entirely for its own
--    INSERT, exactly like private.log_audit_event already does for
--    audit_log).
CREATE TABLE public.delivery_proof (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL UNIQUE REFERENCES public.deliveries(id) ON DELETE CASCADE,
  final_driver_lat numeric,
  final_driver_lng numeric,
  final_location_at timestamptz,
  final_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.delivery_proof IS
  'Admin-only dispute evidence: the driver''s last known position captured at the moment a delivery reached a terminal status, right before the live driver_lat/lng on deliveries is nulled for privacy. final_status records which transition captured it (delivered/cancelled/delivery_failed, or abandoned_retention_sweep for a delivery that never reached a terminal status and was cleaned up by the daily compliance job instead).';

ALTER TABLE public.delivery_proof ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.delivery_proof FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.delivery_proof TO authenticated; -- narrowed by the policy below
GRANT ALL ON public.delivery_proof TO service_role;

CREATE POLICY "delivery_proof admin read" ON public.delivery_proof FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------------------------
-- 2) protect_delivery_status_transition() — CREATE OR REPLACE, body-only
--    change (signature unchanged, it's a trigger function with no
--    arguments). Captures delivery_proof immediately before nulling the
--    live location columns, inside the exact same terminal-transition
--    branch that already deletes customer_delivery_locations.
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
      ('picked_up', 'delivery_failed'), ('en_route_dropoff', 'delivery_failed')
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
-- Règ A11 — INSERT nan menm skript la, dènye deklarasyon anvan COMMIT.
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260821090000', 'fix_delivery_location_retention_leak')
ON CONFLICT (version) DO NOTHING;

COMMIT;

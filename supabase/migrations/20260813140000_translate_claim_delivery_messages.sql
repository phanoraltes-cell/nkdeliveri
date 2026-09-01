-- F-02 remediation (docs/archive/audits/FULL_PLATFORM_AUDIT_2026-08-13.md). Root cause,
-- traced end-to-end (frontend -> hook -> RPC -> database -> constraint ->
-- error -> frontend -> user message) before writing this:
--
--   src/routes/_authenticated/dashboard.driver.available.tsx's claim
--   mutation does `onError: (e) => toast.error(e.message ?? "Erè")` --
--   this is the SAME "the RPC's own RAISE EXCEPTION message IS the final
--   user-facing message" pattern already used everywhere else in this
--   project (confirmed by grep across dozens of mutations this session --
--   there is no separate frontend error-translation layer for RPC
--   business errors, only for auth-specific errors in
--   src/lib/auth-errors.ts, which is a different, narrower concern). The
--   frontend is therefore already correct and needs no change here --
--   per the audit's own instruction not to invent a second i18n system.
--
--   private.claim_delivery_secure ALREADY has a real transition guard
--   (SELECT ... FOR UPDATE on the order row serializes concurrent claims;
--   a losing driver's call blocks until the winner's transaction commits,
--   then correctly sees the order's real state and raises a business-level
--   exception -- never a raw SQL/constraint error). The bug isn't missing
--   validation, it's that 4 of its 5 RAISE EXCEPTION messages were in
--   English, breaking with this entire codebase's Kreyòl-first convention
--   (every other business-facing RPC message read this session is in
--   Kreyòl) -- so a driver losing the race to claim a delivery, or any of
--   the other 4 rejection cases, saw untranslated English text via the
--   verbatim-passthrough toast.
--
-- deliveries.order_id UNIQUE (confirmed live: conname
-- "deliveries_order_id_key") is untouched -- it remains the actual last
-- line of defense; only the messages are translated, exactly matching the
-- required "do not remove the DB protection, do not replace it with a
-- frontend-only check" constraint.
--
-- Full body reproduced (CREATE OR REPLACE requires it) -- every line
-- outside the 5 RAISE EXCEPTION messages is byte-identical to the live
-- function, confirmed by diffing against pg_get_functiondef() before
-- writing this, not retyped from memory.
CREATE OR REPLACE FUNCTION private.claim_delivery_secure(_order_id uuid)
RETURNS deliveries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_driver public.drivers;
  v_order public.orders;
  v_row public.deliveries;
BEGIN
  IF NOT public.check_rate_limit_secure('claim_delivery', 20, 300) THEN
    RAISE EXCEPTION 'Twòp tantativ. Tanpri eseye ankò nan kèk minit.' USING ERRCODE = '42901';
  END IF;

  SELECT * INTO v_driver FROM public.drivers WHERE user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sèlman yon kont livrè ka pran yon livrezon';
  END IF;
  IF v_driver.status <> 'online' THEN
    RAISE EXCEPTION 'Ou dwe an liy pou ka pran yon livrezon';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nou pa jwenn kòmand sa a';
  END IF;
  IF v_order.status <> 'ready' THEN
    -- The realistic race scenario (two drivers, same order): whoever's
    -- transaction blocks on the FOR UPDATE lock above lands here once it
    -- unblocks, because the winner already advanced orders.status to
    -- 'assigned' inside the same transaction that inserted deliveries --
    -- confirmed by reading the rest of this function below. This is the
    -- branch F-02 is actually about, not the EXISTS check further down.
    RAISE EXCEPTION 'Kòmand sa a pa disponib ankò — gen dwa yon lòt livrè deja pran l, oswa estati li chanje.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deliveries WHERE order_id = _order_id) THEN
    RAISE EXCEPTION 'Kòmand sa a deja pran pa yon lòt livrè';
  END IF;

  INSERT INTO public.deliveries (order_id, driver_id, status, fee)
  VALUES (_order_id, v_driver.id, 'assigned', COALESCE(v_order.delivery_fee, 0))
  RETURNING * INTO v_row;

  UPDATE public.orders SET
    status = 'assigned',
    status_history = status_history || jsonb_build_object(
      'from', v_order.status, 'to', 'assigned', 'by', auth.uid(), 'at', now()
    ),
    updated_at = now()
  WHERE id = _order_id;

  RETURN v_row;
END;
$function$;

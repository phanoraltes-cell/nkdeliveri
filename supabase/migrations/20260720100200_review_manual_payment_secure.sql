-- The admin manual-payment review screen wrote straight to public.payments
-- via a raw client-side .update() with no OLD.status guard. RLS already
-- restricts that UPDATE to admin/super_admin (so this was never an
-- authorization gap), but nothing stopped an admin from "approving" a
-- payment that was already paid/failed/refunded — e.g. two admin tabs open
-- on the same queue, or a double-click — silently overwriting review_notes/
-- reviewed_at and, worse, flipping an already-refunded payment back to
-- 'paid' without reversing the refund. Only awaiting_proof/under_review
-- (the two states the review queue actually lists) may now be decided.
CREATE OR REPLACE FUNCTION public.review_manual_payment_secure(
  _payment_id uuid,
  _decision public.payment_status,
  _note text DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.payments;
BEGIN
  IF NOT (public.has_role(v_user, 'admin') OR public.has_role(v_user, 'super_admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF _decision NOT IN ('paid', 'failed') THEN
    RAISE EXCEPTION 'Desizyon envalid';
  END IF;

  SELECT * INTO v_row FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF v_row.status NOT IN ('awaiting_proof', 'under_review') THEN
    RAISE EXCEPTION 'Peman sa a deja trete (estati aktyèl: %)', v_row.status USING ERRCODE = '42501';
  END IF;

  UPDATE public.payments
  SET status = _decision,
      review_notes = NULLIF(btrim(COALESCE(_note, '')), ''),
      reviewed_by = v_user,
      reviewed_at = now()
  WHERE id = _payment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.review_manual_payment_secure(uuid, public.payment_status, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_manual_payment_secure(uuid, public.payment_status, text) TO authenticated;

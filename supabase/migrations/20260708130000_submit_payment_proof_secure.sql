-- orders.$id.tsx submits proof of payment with three client calls: storage
-- upload, payment_proofs insert, then a direct payments UPDATE to move
-- status "awaiting_proof" -> "under_review". That last UPDATE is silently
-- filtered to 0 rows by RLS ("payments admin update" is the only UPDATE
-- policy on payments, admin-only) — Supabase returns no error for an
-- RLS-filtered UPDATE, so the client shows a success toast while
-- payments.status never actually moves. Two real consequences: the customer
-- and merchant "Prèv peman resevwa" notification never fires (the trigger is
-- AFTER UPDATE OF status, which never happens), and the order stays labeled
-- "Ap tann prèv peman" even after proof was uploaded.
--
-- Fix: a single SECURITY DEFINER RPC that inserts the proof and flips the
-- status atomically, validated server-side (caller must own the order, the
-- payment must actually be awaiting proof) — same pattern as
-- claim_delivery_secure / update_order_status_secure elsewhere in this app.
CREATE OR REPLACE FUNCTION public.submit_payment_proof_secure(
  _payment_id uuid,
  _file_url text,
  _transaction_ref text,
  _sender_phone text,
  _notes text
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.payments;
  v_row public.payments;
BEGIN
  SELECT p.* INTO v_payment
  FROM public.payments p
  JOIN public.orders o ON o.id = p.order_id
  WHERE p.id = _payment_id AND o.customer_id = auth.uid()
  FOR UPDATE OF p;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = '42501';
  END IF;

  IF v_payment.status NOT IN ('awaiting_proof', 'pending') THEN
    RAISE EXCEPTION 'This payment is not awaiting proof';
  END IF;

  INSERT INTO public.payment_proofs (payment_id, file_url, transaction_ref, sender_phone, notes, uploaded_by)
  VALUES (_payment_id, _file_url, _transaction_ref, _sender_phone, _notes, auth.uid());

  UPDATE public.payments SET
    status = 'under_review',
    transaction_ref = COALESCE(_transaction_ref, transaction_ref),
    sender_phone = COALESCE(_sender_phone, sender_phone)
  WHERE id = _payment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_payment_proof_secure(uuid, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_payment_proof_secure(uuid, text, text, text, text) TO authenticated;

-- The client no longer inserts payment_proofs directly (the RPC does it as
-- SECURITY DEFINER) — close the direct grant so a payment_proofs row can't
-- be attached to someone else's payment without also flipping its status.
REVOKE INSERT ON public.payment_proofs FROM authenticated;
DROP POLICY IF EXISTS "proofs insert" ON public.payment_proofs;

-- ---------------------------------------------------------------------------
-- dashboard.driver.payouts.tsx is the one remaining self-service write in the
-- app that still goes straight to a table instead of a _secure RPC, unlike
-- its restaurant-side twin (update_restaurant_payout_secure). It isn't an
-- active hole — the existing trg_protect_driver_status_self_update trigger
-- already pins commission_rate against self-tampering regardless of which
-- columns the client sends — but it's the last inconsistency in an otherwise
-- uniform convention. Bring it in line.
CREATE OR REPLACE FUNCTION public.update_driver_payout_secure(
  _driver_id uuid,
  _moncash_number text,
  _natcash_number text,
  _payout_frequency text
)
RETURNS public.drivers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row public.drivers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = _driver_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  IF _payout_frequency NOT IN ('daily', 'monthly') THEN
    RAISE EXCEPTION 'Invalid payout frequency';
  END IF;

  UPDATE public.drivers SET
    moncash_number = _moncash_number,
    natcash_number = _natcash_number,
    payout_frequency = _payout_frequency
  WHERE id = _driver_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
REVOKE ALL ON FUNCTION public.update_driver_payout_secure(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_payout_secure(uuid, text, text, text) TO authenticated;

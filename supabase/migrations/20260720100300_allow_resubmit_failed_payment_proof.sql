-- A customer whose manual payment proof was rejected (payments.status =
-- 'failed') had no way back — submit_payment_proof_secure only accepted
-- 'awaiting_proof'/'pending', so a rejected payment was a permanent dead
-- end even though rejections are often fixable (blurry photo, wrong
-- transaction ref) and the customer already has a real, unrefundable order
-- sitting unpaid. Widening the guard to also allow resubmission from
-- 'failed' lets them upload new proof and go back into the review queue —
-- same signature, CREATE OR REPLACE in place.
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

  IF v_payment.status NOT IN ('awaiting_proof', 'pending', 'failed') THEN
    RAISE EXCEPTION 'This payment is not awaiting proof';
  END IF;

  INSERT INTO public.payment_proofs (payment_id, file_url, transaction_ref, sender_phone, notes, uploaded_by)
  VALUES (_payment_id, _file_url, _transaction_ref, _sender_phone, _notes, auth.uid());

  UPDATE public.payments SET
    status = 'under_review',
    review_notes = NULL,
    transaction_ref = COALESCE(_transaction_ref, transaction_ref),
    sender_phone = COALESCE(_sender_phone, sender_phone)
  WHERE id = _payment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

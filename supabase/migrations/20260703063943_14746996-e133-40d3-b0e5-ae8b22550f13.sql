
-- 1) Trigger: when payment flips to 'paid', confirm the order (if still pending)
CREATE OR REPLACE FUNCTION public.on_payment_paid_confirm_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE public.orders
       SET status = 'confirmed',
           updated_at = now()
     WHERE id = NEW.order_id
       AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_paid_confirm_order ON public.payments;
CREATE TRIGGER trg_payment_paid_confirm_order
AFTER UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.on_payment_paid_confirm_order();

-- 2) Storage RLS for payment-proofs bucket
-- Path convention: <order_id>/<filename>
-- Customer can upload only into a folder matching an order they own.
DROP POLICY IF EXISTS "proofs upload by order customer" ON storage.objects;
CREATE POLICY "proofs upload by order customer"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id::text = (storage.foldername(name))[1]
      AND o.customer_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "proofs read by owner/admin/restaurant" ON storage.objects;
CREATE POLICY "proofs read by owner/admin/restaurant"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id::text = (storage.foldername(name))[1]
        AND (
          o.customer_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.restaurants r
                      WHERE r.id = o.restaurant_id AND r.owner_id = auth.uid())
        )
    )
  )
);

DROP POLICY IF EXISTS "proofs delete by admin" ON storage.objects;
CREATE POLICY "proofs delete by admin"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
);

-- Audit finding: refunds.payment_id has an ON DELETE CASCADE FK but no
-- index (unlike its customer_id/restaurant_id/status siblings), so any
-- delete/cascade touching public.payments forces a seq scan of refunds to
-- find matching rows — same class of gap already fixed for other tables in
-- 20260714120000_add_missing_fk_indexes.sql.
CREATE INDEX IF NOT EXISTS refunds_payment_id_idx ON public.refunds(payment_id);

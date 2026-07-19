-- Audit finding (Faible): low-traffic, admin-only FK columns without an
-- index. Not worth indexing at current scale, but cheap and safe to add
-- now in case an admin view ever filters/joins on "resolved/reviewed by me".
CREATE INDEX IF NOT EXISTS refunds_reviewed_by_idx ON public.refunds(reviewed_by);
CREATE INDEX IF NOT EXISTS disputes_resolved_by_idx ON public.disputes(resolved_by);
CREATE INDEX IF NOT EXISTS dispute_messages_author_id_idx ON public.dispute_messages(author_id);

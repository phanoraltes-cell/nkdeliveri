-- Performance remediation (Phase 3, item 4): the dashboard header's unread-
-- notification badge polled every 30 seconds from every signed-in tab,
-- constant DB load with no relation to whether anything actually changed —
-- flagged as far back as the very first informal audit (demen.md) and
-- never fixed. Every other live-updating piece of this app already uses
-- Supabase Realtime instead of polling (see useLiveOrders.ts), so this
-- moves the badge to the same pattern: a postgres_changes subscription
-- filtered to the signed-in user's own notifications.
--
-- That subscription only receives events for tables added to the
-- supabase_realtime publication — deliveries/orders were added in
-- 20260703072853_92f5610f-...sql, notifications never was. Without this,
-- the new subscription would silently never fire (no error, just no
-- events), leaving the badge frozen at its initial value — worse than the
-- polling it replaces.

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

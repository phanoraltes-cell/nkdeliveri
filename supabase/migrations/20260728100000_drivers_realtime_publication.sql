-- Performance audit follow-up: the admin dashboard's "livrè an liy" list
-- polled every 15s (src/routes/_authenticated/dashboard.admin.index.tsx)
-- instead of using Realtime like every other live section of the app —
-- because `drivers` was never added to the supabase_realtime publication
-- in the first place. Adding it here is what makes the new
-- postgres_changes subscription in that route actually fire; RLS is
-- unaffected (drivers_self_select/drivers_admin_all already let an admin
-- read every driver row today via the polled query this replaces).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'drivers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
  END IF;
END $$;

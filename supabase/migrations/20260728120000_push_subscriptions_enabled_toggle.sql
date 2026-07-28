-- "Mes appareils" (push notification UX phase): lets a user pause push
-- notifications for one specific device without deleting its registration
-- (deleting would also drop the browser-level PushSubscription silently
-- diverging from what's shown in the UI on that device the next time it's
-- opened). pushToUsers (src/lib/push-dispatch.server.ts) is updated in
-- this same phase to filter on this column.
ALTER TABLE public.push_subscriptions ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;

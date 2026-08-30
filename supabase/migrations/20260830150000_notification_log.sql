-- TACH 2 (PROMPT MODIFIKASYON — NOTIFIKASYON KI SONNEN SOU TELEFÒN NAN)
--
-- ENVESTIGASYON (avan chanjman) — sa ki DEJA egziste e ki DEJA mache, pa
-- touche/reyekri:
--   - PWA konplè: manifest.webmanifest + src/sw.ts (precache, offline.html,
--     push+notificationclick handlers).
--   - Web Push konplè ak kle VAPID nan varyab anviwònman (JAMÈ nan kòd la —
--     process.env.VAPID_SUBJECT/VAPID_PUBLIC_KEY/VAPID_PRIVATE_JWK, wè
--     push-dispatch.server.ts), tab `push_subscriptions` (miltip aparèy pa
--     itilizatè), netwayaj otomatik abònman ki mouri (404/410), pwoteksyon
--     SSRF sou URL endpoint (push-endpoint-allowlist.ts).
--   - Kontni mesaj REYÈL (tit+kò+ikòn+lyen+tag) deja egziste pou tout sik
--     lavi kòmand la (send-order-push.functions.ts): nouvo kòmand→restoran,
--     livrezon asiyen→livrè, kòmand livre→kliyan.
--   - Son+vibrasyon deja jere pa preferans itilizatè (notification_preferences
--     .prefs.sound/.vibration), li nan sw.ts (`silent`/`vibrate`).
--   - Ekran "poukisa" AVAN popup navigatè a (notification-permission-dialog.tsx),
--     deklannche apre koneksyon (pa nan premye vizit), ak yon paj èd si
--     itilizatè a refize deja (notification-permission-denied-help.tsx).
--   - `private.notify_secure` — motè jeneriz nouvo (dispute/gps/chat) ki
--     deja respekte yon switch PA KATEGORI (`prefs[category]`, pwomosyon
--     opt-in, tout lòt opt-out) anvan menm kreye ranje `notifications` la.
--
-- SA KI VRÈMAN MANKE (sa migrasyon/kòd sa a ajoute) :
--   1. `notification_log` — pa gen okenn jounal fyabilite/depanaj pou
--      voye push/SMS yo (tab sa a).
--   2. SMS kòm sekou — pa gen okenn abstraksyon/founisè SMS ditou (kreye
--      nan lib/sms/, PA nan migrasyon sa a — se kòd TypeScript sèvè, pa SQL).
--   3. `requireInteraction`/ensistans pou restoran/livrè — jere nan sw.ts +
--      push-dispatch.server.ts (kòd, pa SQL).
--   4. Swit pa kanal (push/SMS aktive/dezaktive) — AJOUTE kòm nouvo kle
--      nan MENM jsonb `notification_preferences.prefs` ki egziste deja
--      (`push_enabled`/`sms_enabled`), PA yon nouvo tab relasyonèl: RPC
--      `update_notification_preferences_secure` deja aksepte NENPÒT kle
--      jsonb bulean san modifye l, kidonk OKENN migrasyon pa nesesè pou
--      pwen sa a — jis nouvo switch UI + kòd dispatch ki li kle yo.

CREATE TABLE public.notification_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'in_app')),
  title text,
  body text,
  status text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notification_log_user_id_idx ON public.notification_log(user_id);
CREATE INDEX notification_log_created_at_idx ON public.notification_log(created_at DESC);
CREATE INDEX notification_log_status_idx ON public.notification_log(status);
CREATE INDEX notification_log_channel_idx ON public.notification_log(channel);

ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Li sèlman: pwòp itilizatè a oswa admin. Ekriti pase EGZKLIZIVMAN pa
-- `supabaseAdmin` (service_role, sèvè sèlman) nan push-dispatch.server.ts/
-- sms-dispatch.server.ts — okenn kliyan pa dwe janm ekri dirèkteman nan
-- yon jounal fyabilite (menm rezon ak audit_log, ki menm modèl la).
CREATE POLICY "notification_log read" ON public.notification_log FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

REVOKE ALL ON public.notification_log FROM PUBLIC, anon;
GRANT SELECT ON public.notification_log TO authenticated;
GRANT ALL ON public.notification_log TO service_role;

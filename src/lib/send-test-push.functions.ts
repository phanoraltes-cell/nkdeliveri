import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pushToUsers, enforceRateLimit } from "@/lib/push-dispatch.server";

/**
 * TACH 2 — kritè aksèptasyon #1 ("Mwen enstale sit la sou telefòn mwen,
 * mwen aktive notifikasyon -> mwen resevwa yon notifikasyon tès"). Voye
 * bay TÈT itilizatè a sèlman (jamè yon lòt moun) — pa gen `data`
 * inpòtan, sèl objektif se konfime son+vibrasyon+afichaj mache.
 */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!(await enforceRateLimit(context.supabase, "send_test_push", 5, 300))) {
      return { sent: 0, rateLimited: true };
    }
    return pushToUsers([context.userId], {
      title: "Tès notifikasyon ✅",
      body: "Si w wè sa a epi w tande yon son, notifikasyon push ou byen konfigire.",
      url: "/dashboard/notifications",
      tag: "test-push",
    });
  });

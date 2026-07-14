import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1),
});

const RESEND_FROM = "NK Deliveri <newsletter@nkdeliveri.com>";
const BATCH_SIZE = 10;

export const sendNewsletterBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" });
    if (!isAdmin && !isSuperAdmin) throw new Error("Forbidden");

    const { data: allowed, error: rlErr } = await supabase.rpc("check_rate_limit_secure", {
      _action: "send_newsletter",
      _max_hits: 3,
      _window_seconds: 3600,
    });
    if (rlErr) throw new Error(rlErr.message);
    if (!allowed) throw new Error("Twòp anvwa nan yon ti tan. Tanpri eseye ankò nan yon èdtan.");

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "RESEND_API_KEY pa konfigire. Ajoute l nan varyab anviwonman yo (Vercel Project Settings → Environment Variables) epi redeploy.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: subscribers, error } = await supabaseAdmin
      .from("newsletter_subscribers")
      .select("email")
      .is("unsubscribed_at", null);
    if (error) throw new Error(error.message);
    if (!subscribers || subscribers.length === 0) return { sent: 0, failed: 0, total: 0 };

    let sent = 0;
    let failed = 0;

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((s) =>
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: RESEND_FROM,
              to: [s.email],
              subject: data.subject,
              html: data.html,
            }),
          }),
        ),
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.ok) sent++;
        else failed++;
      }
    }

    return { sent, failed, total: subscribers.length };
  });

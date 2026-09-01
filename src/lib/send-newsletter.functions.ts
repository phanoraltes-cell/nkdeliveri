import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1),
});

const RESEND_FROM = "NK Deliveri <newsletter@nkdeliveri.com>";
const BATCH_SIZE = 10;
// Resend error bodies are occasionally verbose (validation errors echo the
// full payload) -- capped so one bad recipient can't bloat the log table.
const ERROR_TRUNCATE_LENGTH = 500;

export type SendResult = {
  email: string;
  success: boolean;
  httpStatus: number | null;
  error: string | null;
  durationMs: number;
};

/**
 * One Resend API call, never throws -- every outcome (HTTP error, network
 * failure, timeout) is captured as data instead of propagating, so the
 * caller can always log + tally it. This is the fix for the audit's Pwen A
 * (docs/archive/audits/NEWSLETTER_EMAIL_REMEDIATION_AUDIT.md): before this, any failure
 * reason (rate limit, invalid key, network blip...) was thrown away at the
 * `else failed++` line with nothing recorded anywhere.
 */
export async function sendOne(
  email: string,
  apiKey: string,
  subject: string,
  html: string,
): Promise<SendResult> {
  const start = Date.now();
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: RESEND_FROM, to: [email], subject, html }),
    });
    const durationMs = Date.now() - start;
    // Read the body exactly once via .text() regardless of outcome -- a
    // second read attempt after a failed .json() would find the body
    // already disturbed (the same Fetch-spec pitfall fixed in
    // plop-client.server.ts's parseJsonOrThrow, docs/archive/plop/PLOP_CLIENT_REMEDIATION_REPORT.md).
    const rawText = await response.text();
    if (response.ok) {
      return { email, success: true, httpStatus: response.status, error: null, durationMs };
    }
    let message = rawText;
    try {
      const parsed = JSON.parse(rawText) as { message?: string };
      message = parsed.message ?? rawText;
    } catch {
      // Not JSON -- rawText itself is already the best available detail.
    }
    return {
      email,
      success: false,
      httpStatus: response.status,
      error: message.slice(0, ERROR_TRUNCATE_LENGTH) || `HTTP ${response.status}`,
      durationMs,
    };
  } catch (e) {
    return {
      email,
      success: false,
      httpStatus: null,
      error: (e instanceof Error ? e.message : "Erè rezo enkoni").slice(0, ERROR_TRUNCATE_LENGTH),
      durationMs: Date.now() - start,
    };
  }
}

export const sendNewsletterBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isSuperAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
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
    if (!subscribers || subscribers.length === 0) {
      return { sent: 0, failed: 0, total: 0, broadcastId: null, failureSamples: [] };
    }

    // Shared across every row this call writes, so a future query can group
    // "all the log lines from this one admin click" without a parent table.
    const broadcastId = crypto.randomUUID();
    let sent = 0;
    let failed = 0;
    // Up to 3 distinct reasons, surfaced straight back to the admin in the
    // toast -- the log table is the full record, but this avoids needing a
    // separate query just to see *why* a send just failed.
    const failureSamples: string[] = [];

    for (let i = 0; i < subscribers.length; i += BATCH_SIZE) {
      const batch = subscribers.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((s) => sendOne(s.email, apiKey, data.subject, data.html)),
      );

      for (const r of results) {
        if (r.success) {
          sent++;
        } else {
          failed++;
          if (failureSamples.length < 3 && r.error) {
            failureSamples.push(`${r.httpStatus ?? "?"}: ${r.error}`);
          }
        }
      }

      // Written per-batch (not once at the end) so a run that never
      // finishes -- e.g. the audit's Pwen C timeout risk -- still leaves
      // evidence for every batch that did complete. Best-effort: a logging
      // failure must never block the actual broadcast.
      try {
        await supabaseAdmin.from("newsletter_send_log").insert(
          results.map((r) => ({
            broadcast_id: broadcastId,
            subject: data.subject,
            recipient_email: r.email,
            success: r.success,
            http_status: r.httpStatus,
            error: r.error,
            duration_ms: r.durationMs,
            triggered_by: userId,
          })),
        );
      } catch (logErr) {
        console.error("[newsletter] failed to write send log", logErr);
      }
    }

    return { sent, failed, total: subscribers.length, broadcastId, failureSamples };
  });

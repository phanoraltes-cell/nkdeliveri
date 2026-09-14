import { createFileRoute } from "@tanstack/react-router";
import { apiMethods } from "@/lib/api-methods";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { sanitize } from "@/lib/ai/sanitize";
import {
  askClaude,
  streamClaude,
  describeClaudeFailure,
  isAiConfigured,
  MODEL_FAST,
  MODEL_STRONG,
  AiNotConfiguredError,
} from "@/lib/ai/claude";
import {
  SUMMARY_SYSTEM_PROMPT,
  PRIORITIES_SYSTEM_PROMPT,
  AD_SYSTEM_PROMPT,
  MESSAGE_SYSTEM_PROMPT,
  buildMessageDraftPrompt,
  buildAdDraftPrompt,
} from "@/lib/ai/prompts";

/**
 * TACH 2 (ASISTAN AI ADMIN) — sèl wout HTTP ki pale ak API Claude a. Yon
 * wout API BRIT (`server.handlers`, menm konvansyon ak api.csp-report.ts/
 * api.webhooks.*.ts), PA yon `createServerFn` — Feature 1/2/4 mande
 * streaming SSE, ki bezwen kontwòl total sou `Response`/`ReadableStream`
 * la, kichòy yon server function pa bay isit la.
 *
 * OTORIZASYON (2 kouch, tou de sou sèvè a, JAMÈ fè konfyans a yon
 * paramèt kliyan an voye):
 *   1. Validasyon JWT Bearer — MENM lojik ak requireSupabaseAuth
 *      (src/integrations/supabase/auth-middleware.ts), repwodwi isit la
 *      paske yon middleware "function"-type pa ka konpoze dirèkteman nan
 *      yon handler HTTP brit tankou sa a.
 *   2. Verifikasyon wòl admin/super_admin — PLIS pase requireSupabaseAuth
 *      (ki verifye sèlman "moun nan konekte", pa "moun nan se admin"),
 *      via user_roles (query dirèk ak service role, pa yon RPC ki ta ka
 *      kwè yon paramèt kliyan).
 *
 * Rate limit: reyitilize check_rate_limit_secure ki DEJA egziste (menm RPC
 * ak tout lòt limit nan pwojè a) — okenn nouvo tab/kolòn pou "konte apèl
 * jodi a" envante.
 */

const AI_MAX_CALLS_PER_DAY = Number(process.env.AI_MAX_CALLS_PER_DAY) || 50;

type Feature = "summary" | "message" | "ad" | "priorities";

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function authenticateAdmin(
  request: Request,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; message: string }> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return { ok: false, status: 500, message: "Konfigirasyon sèvè a enkonplè." };
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Ou dwe konekte." };
  }
  const token = authHeader.replace("Bearer ", "");
  if (!token || token.split(".").length !== 3) {
    return { ok: false, status: 401, message: "Sesyon envalid." };
  }

  const scopedClient = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await scopedClient.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return { ok: false, status: 401, message: "Sesyon envalid." };
  }
  const userId = data.claims.sub as string;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: roleRows, error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["admin", "super_admin"]);
  if (roleErr) return { ok: false, status: 500, message: "Erè verifikasyon wòl." };
  if (!roleRows || roleRows.length === 0) {
    return { ok: false, status: 403, message: "Sèlman admin ka itilize asistan AI a." };
  }

  return { ok: true, userId };
}

async function logUsage(
  adminId: string,
  feature: Feature,
  model: string,
  usage: { inputTokens: number; outputTokens: number } | null,
  status: "success" | "error",
  error?: string,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_usage_log").insert({
      admin_id: adminId,
      feature,
      model,
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
      status,
      error: error ?? null,
    });
  } catch (err) {
    console.warn("[ai_usage_log] insert failed", err);
  }
}

export const Route = createFileRoute("/api/admin/ai")({
  server: {
    handlers: apiMethods({
      POST: async ({ request }) => {
        if (!isAiConfigured()) {
          // Kritè aksèptasyon #5: si kle a manke, panèl la montre yon
          // mesaj klè — rès dashboard la kontinye mache. Isit la se
          // menm mesaj la, jis nan yon repons ki pa 500 brit.
          const notConfigured = describeClaudeFailure(new AiNotConfiguredError());
          return new Response(
            JSON.stringify({ error: notConfigured.message, kind: notConfigured.kind }),
            {
              status: notConfigured.status,
              headers: { "content-type": "application/json" },
            },
          );
        }

        const auth = await authenticateAdmin(request);
        if (!auth.ok) {
          return new Response(JSON.stringify({ error: auth.message }), {
            status: auth.status,
            headers: { "content-type": "application/json" },
          });
        }
        const { userId } = auth;

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return new Response(JSON.stringify({ error: "Kò demand envalid." }), { status: 400 });
        }
        const feature = body.feature as Feature;
        if (!["summary", "message", "ad", "priorities"].includes(feature)) {
          return new Response(JSON.stringify({ error: "Feature envalid." }), { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: allowed, error: rlErr } = await supabaseAdmin.rpc("check_rate_limit_secure", {
          _action: "admin_ai_call",
          _max_hits: AI_MAX_CALLS_PER_DAY,
          _window_seconds: 86400,
          _actor_override: userId,
        });
        if (rlErr || !allowed) {
          return new Response(
            JSON.stringify({
              error: `Ou rive nan limit ${AI_MAX_CALLS_PER_DAY} apèl AI pa jou. Tanpri eseye demen.`,
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }

        // ---- Feature 3 (piblisite) — repons JSON konplè, pa streaming:
        // rezilta a se yon estrikti (3 kat) ki bezwen analize antye anvan
        // "Itilize sa a" ka ranpli fòm nan; yon rezilta konplè yon sèl fwa
        // pi solid pase pasyèl JSON k ap konstwi pandan l ap resevwa.
        if (feature === "ad") {
          const input = sanitize(body.input) as {
            announcing: string;
            target: "tout_moun" | "nouvo_kliyan" | "yon_zon";
            targetDetail?: string;
            date?: string;
          };
          try {
            const prompt = buildAdDraftPrompt(input);
            const result = await askClaude({
              model: MODEL_STRONG,
              systemPrompt: AD_SYSTEM_PROMPT,
              userMessage: prompt,
              maxTokens: 1500,
            });
            await logUsage(userId, "ad", result.model, result, "success");
            let proposals: unknown;
            try {
              const jsonMatch = result.text.match(/\[[\s\S]*\]/);
              proposals = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
            } catch {
              throw new Error("Claude pa retounen yon JSON valid.");
            }
            return new Response(JSON.stringify({ proposals }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          } catch (err) {
            // Estati a soti nan kategori echèk la, pa yon 502 fiks: yon kont
            // san kredi bay 402, yon kle refize bay 401, yon kle ki manke
            // bay 503. Se konsa yon moun ki gade Network tab la konnen
            // kisa k ap pase san li pa louvri jounal la.
            const failure = describeClaudeFailure(err);
            await logUsage(
              userId,
              "ad",
              MODEL_STRONG,
              null,
              "error",
              failure.detail || failure.kind,
            );
            return new Response(JSON.stringify({ error: failure.message, kind: failure.kind }), {
              status: failure.status,
              headers: { "content-type": "application/json" },
            });
          }
        }

        // ---- Feature 1/2/4 — SSE streaming.
        let model: string;
        let systemPrompt: string;
        let userMessage: string;
        let maxTokens: number;

        if (feature === "summary") {
          const period = (body.period as string) || "today";
          const regenerate = body.regenerate === true;
          model = MODEL_FAST;
          maxTokens = 1200;
          systemPrompt = SUMMARY_SYSTEM_PROMPT;

          if (!regenerate) {
            const { data: cached } = await supabaseAdmin
              .from("ai_summary_cache")
              .select("summary, generated_at")
              .eq("period", period)
              .eq("cache_date", new Date().toISOString().slice(0, 10))
              .maybeSingle();
            if (cached) {
              return new Response(
                sse("delta", { text: cached.summary }) +
                  sse("done", { cached: true, generatedAt: cached.generated_at }),
                {
                  status: 200,
                  headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
                },
              );
            }
          }

          const { data: stats, error: statsErr } = await supabaseAdmin.rpc(
            "get_admin_ai_traffic_stats_secure",
            { _period: period },
          );
          if (statsErr) {
            return new Response(JSON.stringify({ error: "Pa ka chaje done trafik yo." }), {
              status: 500,
            });
          }
          userMessage = `Done JSON (peryòd: ${period}):\n${JSON.stringify(sanitize(stats))}`;

          const encoder = new TextEncoder();
          const readable = new ReadableStream({
            async start(controller) {
              let fullText = "";
              try {
                const { textStream, usage } = streamClaude({
                  model,
                  systemPrompt,
                  userMessage,
                  maxTokens,
                });
                for await (const chunk of textStream) {
                  fullText += chunk;
                  controller.enqueue(encoder.encode(sse("delta", { text: chunk })));
                }
                const finalUsage = await usage;
                await Promise.all([
                  logUsage(userId, "summary", finalUsage.model, finalUsage, "success"),
                  supabaseAdmin.from("ai_summary_cache").upsert(
                    {
                      period,
                      cache_date: new Date().toISOString().slice(0, 10),
                      summary: fullText,
                      stats: sanitize(stats) as never,
                      model: finalUsage.model,
                      generated_by: userId,
                      generated_at: new Date().toISOString(),
                    },
                    { onConflict: "period,cache_date" },
                  ),
                ]);
                controller.enqueue(encoder.encode(sse("done", { cached: false })));
              } catch (err) {
                // Stream la deja kòmanse, donk kòd HTTP la deja voye — nou pa ka
                // chanje l. Nou voye kategori a nan evènman an pou UI a ka montre
                // bon aksyon an, epi describeClaudeFailure ekri kòz la nan jounal.
                const failure = describeClaudeFailure(err);
                await logUsage(
                  userId,
                  "summary",
                  model,
                  null,
                  "error",
                  failure.detail || failure.kind,
                );
                controller.enqueue(
                  encoder.encode(sse("error", { message: failure.message, kind: failure.kind })),
                );
              } finally {
                controller.close();
              }
            },
          });
          return new Response(readable, {
            status: 200,
            headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
          });
        }

        if (feature === "priorities") {
          model = MODEL_FAST;
          maxTokens = 800;
          systemPrompt = PRIORITIES_SYSTEM_PROMPT;
          const { data: priorities, error: prioErr } = await supabaseAdmin.rpc(
            "get_admin_priorities_secure",
          );
          if (prioErr) {
            return new Response(JSON.stringify({ error: "Pa ka chaje done priyorite yo." }), {
              status: 500,
            });
          }
          userMessage = `Done JSON:\n${JSON.stringify(sanitize(priorities))}`;
        } else {
          // feature === "message"
          model = MODEL_STRONG;
          maxTokens = 1500;
          const input = sanitize(body.input) as {
            messageType:
              "customer_notification" | "restaurant_message" | "report_reply" | "site_announcement";
            language: "kreyol" | "franse";
            tone: "formal" | "amikal" | "dirèk";
            length: "kout" | "mwayen";
            context: string;
          };
          systemPrompt = MESSAGE_SYSTEM_PROMPT;
          userMessage = buildMessageDraftPrompt(input);
        }

        const encoder = new TextEncoder();
        const readable = new ReadableStream({
          async start(controller) {
            try {
              const { textStream, usage } = streamClaude({
                model,
                systemPrompt,
                userMessage,
                maxTokens,
              });
              for await (const chunk of textStream) {
                controller.enqueue(encoder.encode(sse("delta", { text: chunk })));
              }
              const finalUsage = await usage;
              await logUsage(userId, feature, finalUsage.model, finalUsage, "success");
              controller.enqueue(encoder.encode(sse("done", {})));
            } catch (err) {
              // Menm bagay ak lòt branch stream la: kategori a nan evènman an,
              // kòz la nan jounal la.
              const failure = describeClaudeFailure(err);
              await logUsage(userId, feature, model, null, "error", failure.detail || failure.kind);
              controller.enqueue(
                encoder.encode(sse("error", { message: failure.message, kind: failure.kind })),
              );
            } finally {
              controller.close();
            }
          },
        });
        return new Response(readable, {
          status: 200,
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      },
    }),
  },
});

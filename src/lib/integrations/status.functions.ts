import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  INTEGRATIONS,
  INTEGRATION_LABEL,
  logIntegrationFailure,
  type FailureKind,
  type IntegrationId,
} from "@/lib/integrations/failure";

/**
 * EKRAN « ETA SISTÈM NAN » — bò sèvè a.
 *
 * Sa a se repons dirèk la a ensidan `/api/admin/ai` la. Pandan jou pàn nan,
 * pa t gen okenn kote pou yon admin gade epi wè « Anthropic: konfigire men
 * apèl yo ap echwe depi 3 jou, rezon: kont san kredi ». Enfòmasyon an te
 * egziste — nan jounal Vercel — men pa gen moun ki t ap gade la.
 *
 * DE RÈG SEKIRITE KI PA NEGOSYAB ISIT LA:
 *
 *   1. **Nou pa JANM retounen valè yon kle.** Sèlman `configured: true` /
 *      `false`, plis NON varyab ki manke yo. Yon ekran dyagnostik ki fè
 *      fwit yon kle se yon pi gwo pwoblèm pase pàn li t ap dyagnostike a.
 *   2. **Admin sèlman.** `requireSupabaseAuth` di sèlman « moun nan
 *      konekte »; nou verifye wòl la apa, sou sèvè a, ak `get_primary_role`
 *      — menm modèl ak wout `/api/admin/ai` la.
 */

/** Varyab anviwònman chak entegrasyon bezwen pou l konsidere konfigire. */
const REQUIRED_ENV: Record<IntegrationId, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  plop: ["PLOP_BASE_URL", "PLOP_CLIENT_ID", "PLOP_CLIENT_SECRET"],
  moncash: ["MONCASH_CLIENT_ID", "MONCASH_CLIENT_SECRET"],
  natcash: [],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"],
  push: ["VAPID_SUBJECT", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_JWK"],
  sms: ["SMS_PROVIDER"],
  storage: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  // Kote sèvè a sèlman. Kote kliyan an PA ka tcheke ak `process.env` —
  // wè `SENTRY_CLIENT_DSN_AT_BUILD` pi ba a.
  sentry: ["SENTRY_DSN"],
};

/**
 * DSN KLIYAN AN, JAN LI TE YE LÈ BUILD LA TE FÈT.
 *
 * Se pwen ki konte a, epi se yon pyèj ki merite eksplikasyon.
 *
 * Vite SELE `import.meta.env.VITE_*` nan moman build la. Si ou poze
 * `VITE_SENTRY_DSN` nan Vercel epi ou REDEPLWAYE SAN REBATI, bundle kliyan
 * an rete san DSN — men `process.env.VITE_SENTRY_DSN` bò sèvè a AP LA,
 * paske Vercel ekspoze tout varyab bay fonksyon an. Yon tchèk ki sèvi ak
 * `process.env` ta di « konfigire » pandan navigatè yo pa voye anyen.
 *
 * Mezire sou pwodiksyon an: chunk `sentry-browser-Bi5-zmmD.js` fè 102 octè
 * epi `captureExceptionClient` se literalman `function n(e){}`. SDK a pa
 * dòman — li ELIMINE nèt pa tree-shaking, paske `if (!dsn) return` te rann
 * tout kò a inatenyab nan moman build la.
 *
 * `import.meta.env` nan bundle SSR a sibi MENM ranplasman an nan menm build
 * la, donk valè sa a se yon prèv dirèk sou sa bundle kliyan an genyen.
 */
const SENTRY_CLIENT_DSN_AT_BUILD = import.meta.env.VITE_SENTRY_DSN as string | undefined;

/** Tab jounal ki deja egziste pou chak entegrasyon (si genyen). */
const LOG_TABLE: Partial<
  Record<IntegrationId, "plop_api_logs" | "moncash_api_logs" | "stripe_api_logs">
> = {
  plop: "plop_api_logs",
  moncash: "moncash_api_logs",
  stripe: "stripe_api_logs",
};

export type IntegrationStatus = {
  id: IntegrationId;
  label: string;
  configured: boolean;
  /** NON varyab ki manke yo — jamè valè yo. */
  missingEnv: string[];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  /** `false` lè pa gen tab jounal pou sèvis sa a — bouton Teste a se sèl verite a. */
  hasHistory: boolean;
};

async function assertAdmin(supabase: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  rpc: (fn: "get_primary_role", args: { _user_id: string }) => Promise<{ data: unknown }>;
}): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Ou dwe konekte.");
  const { data: role } = await supabase.rpc("get_primary_role", { _user_id: userId });
  if (role !== "admin" && role !== "super_admin") {
    throw new Error("Sèlman admin ka wè eta sistèm nan.");
  }
}

export const getIntegrationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    await assertAdmin(supabase as never);

    const rows: IntegrationStatus[] = [];
    for (const id of INTEGRATIONS) {
      const required = REQUIRED_ENV[id];
      const missingEnv = required.filter((name) => !process.env[name]);
      // Sentry gen de bò endepandan. Bò kliyan an pa ka tcheke ak
      // `process.env` (wè SENTRY_CLIENT_DSN_AT_BUILD): nou ajoute l nan lis
      // sa ki manke a ak yon non ki di sa pou fè — rebati, pa sèlman poze.
      if (id === "sentry" && !SENTRY_CLIENT_DSN_AT_BUILD) {
        missingEnv.push("VITE_SENTRY_DSN (nan build la — mande yon REBATI, pa yon redeplwaman)");
      }

      let lastSuccessAt: string | null = null;
      let lastFailureAt: string | null = null;
      let lastFailureReason: string | null = null;

      const table = LOG_TABLE[id];
      if (table) {
        // Dènye apèl ki reyisi ak dènye ki echwe, apa — se de kesyon
        // diferan. « Dènye apèl la echwe » pa di anyen si li te sèl apèl
        // la nan yon semèn; « dènye siksè: 3 jou pase » di tout bagay.
        const [ok, bad] = await Promise.all([
          supabase
            .from(table)
            .select("created_at")
            .is("error", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from(table)
            .select("created_at, error, http_status")
            .not("error", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        lastSuccessAt = ok.data?.created_at ?? null;
        lastFailureAt = bad.data?.created_at ?? null;
        lastFailureReason = bad.data
          ? `${bad.data.http_status ?? "—"} · ${String(bad.data.error).slice(0, 160)}`
          : null;
      } else if (id === "anthropic") {
        // `ai_usage_log` gen pwòp fòm pa l (`status` = 'ok' | 'error').
        const [ok, bad] = await Promise.all([
          supabase
            .from("ai_usage_log")
            .select("created_at")
            .eq("status", "ok")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("ai_usage_log")
            .select("created_at, error")
            .eq("status", "error")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        lastSuccessAt = ok.data?.created_at ?? null;
        lastFailureAt = bad.data?.created_at ?? null;
        lastFailureReason = bad.data?.error ? String(bad.data.error).slice(0, 160) : null;
      }

      rows.push({
        id,
        label: INTEGRATION_LABEL[id],
        // NatCash pa gen varyab pa l (li pase pa PLOP) — li konfigire depi
        // PLOP konfigire. Yon lis vid ta di « konfigire » an silans, sa ki
        // ta manti; nou mare l sou PLOP eksplisitman.
        configured:
          id === "natcash"
            ? REQUIRED_ENV.plop.every((n) => !!process.env[n])
            : missingEnv.length === 0,
        missingEnv,
        lastSuccessAt,
        lastFailureAt,
        lastFailureReason,
        hasHistory: !!table || id === "anthropic",
      });
    }

    return rows;
  });

const TestInput = z.object({ integration: z.enum(INTEGRATIONS) });

export type IntegrationTestResult = {
  ok: boolean;
  kind: FailureKind | null;
  message: string;
};

/**
 * Yon apèl MINIM pou chak sèvis — jis ase pou konnen si li reponn.
 *
 * Pou Anthropic se yon mesaj 1 token: li touche fakturasyon, otantifikasyon
 * ak egzistans modèl la — twa kòz ki pi souvan yo — pou yon pri ki prèske
 * zewo. Pou lòt yo nou pa fè yon apèl ki deplase lajan; nou verifye
 * konfigirasyon an epi nou di sa klèman.
 */
export const testIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => TestInput.parse(data))
  .handler(async ({ data, context }): Promise<IntegrationTestResult> => {
    const { supabase } = context;
    await assertAdmin(supabase as never);

    const missing = (
      data.integration === "natcash" ? REQUIRED_ENV.plop : REQUIRED_ENV[data.integration]
    ).filter((name) => !process.env[name]);
    if (missing.length > 0) {
      return {
        ok: false,
        kind: "not_configured",
        message: `Varyab sa yo manke: ${missing.join(", ")}. Ajoute yo nan Vercel (Production) epi redeplwaye.`,
      };
    }

    if (data.integration === "anthropic") {
      try {
        const { askClaude, MODEL_FAST } = await import("@/lib/ai/claude");
        await askClaude({
          model: MODEL_FAST,
          systemPrompt: "Reponn ak yon sèl mo.",
          userMessage: "ping",
          maxTokens: 4,
        });
        return { ok: true, kind: null, message: "Apèl tès la reyisi." };
      } catch (err) {
        const { classifyAnthropicError } = await import("@/lib/integrations/anthropic-failure");
        const failure = classifyAnthropicError(err);
        logIntegrationFailure(failure);
        return { ok: false, kind: failure.kind, message: failure.message };
      }
    }

    if (data.integration === "sentry") {
      // Nou pa voye yon fo erè nan Sentry pou yon tès — sa ta poliye jounal
      // la ak yon ensidan ki pa reyèl, epi jou yon vrè bug rive pèsonn pa
      // ta konnen kiyès ki kiyès. Nou reponn sou konfigirasyon an sèlman,
      // epi nou separe de bò yo paske yo tonbe pou rezon diferan.
      if (!SENTRY_CLIENT_DSN_AT_BUILD) {
        return {
          ok: false,
          kind: "not_configured",
          message:
            "Bò sèvè a konfigire, men bundle kliyan an PA gen DSN an. Vite sele " +
            "VITE_SENTRY_DSN nan moman build la: poze varyab la nan Vercel EPI " +
            "rebati (yon senp redeplwaman kenbe ansyen bundle la). Toutotan sa pa " +
            "fèt, okenn erè navigatè pa rive nan Sentry.",
        };
      }
      return {
        ok: true,
        kind: null,
        message: "De bò yo konfigire: SENTRY_DSN bò sèvè a, VITE_SENTRY_DSN nan bundle kliyan an.",
      };
    }

    if (data.integration === "storage") {
      try {
        const { error } = await supabase.storage.from("payment-proofs").list("", { limit: 1 });
        if (error) throw error;
        return { ok: true, kind: null, message: "Depo a reponn." };
      } catch (err) {
        return {
          ok: false,
          kind: "provider_error",
          message: `Depo a pa reponn: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Rès yo: nou pa fè yon apèl ki ta ka deplase lajan (yon rechaj, yon
    // retrè, yon SMS) jis pou yon tès. Nou di verite a: konfigirasyon an
    // konplè, epi verite operasyonèl la nan istwa apèl yo pi wo a.
    return {
      ok: true,
      kind: null,
      message:
        "Konfigirasyon an konplè. Nou pa fè yon apèl tès ki ta deplase lajan — gade dènye apèl yo pi wo a pou eta reyèl la.",
    };
  });

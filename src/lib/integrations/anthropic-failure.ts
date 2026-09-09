import Anthropic from "@anthropic-ai/sdk";
import {
  integrationFailure,
  type FailureKind,
  type IntegrationFailure,
} from "@/lib/integrations/failure";

/**
 * Klasifikatè erè Anthropic la — modil ki soti dirèkteman nan ensidan
 * `/api/admin/ai` la.
 *
 * BAGAY KI PI ENPÒTAN NAN FICHYE SA A: yon kont san kredi retounen yon
 * **HTTP 400**, pa yon 402 ni yon 403. Nan SDK a se yon `BadRequestError`,
 * menm klas ak yon pwomt ki malfòme. Si w klase pa klas SDK a sèlman — sa
 * ki te la anvan — ou jwenn « Sèvis AI a retounen yon erè (400) », ki fè
 * yon devlopè chèche yon bug nan pwomt la pandan jou. Sèl bagay ki
 * distenge de a se TÈKS mesaj la. Se poutèt sa nou li tèks la.
 */

/** Siyati Anthropic sèvi lè balans kont lan twò ba. */
const CREDIT_PATTERNS = [/credit balance is too low/i, /insufficient[_ ]credit/i, /billing/i];

/** Erè ki pa gen okenn kle konfigire ditou — leve pa `claude.ts` anvan menm yon apèl. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY pa konfigire sou sèvè a.");
    this.name = "AiNotConfiguredError";
  }
}

function errorText(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    // `err.error` se kò JSON founisè a; `err.message` se rezime SDK a.
    const body = err.error as { error?: { message?: string; type?: string } } | undefined;
    return [body?.error?.message, err.message].filter(Boolean).join(" ");
  }
  return err instanceof Error ? err.message : String(err);
}

function providerCode(err: unknown): string | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  const body = err.error as { error?: { type?: string } } | undefined;
  return body?.error?.type ?? null;
}

function requestId(err: unknown): string | null {
  if (!(err instanceof Anthropic.APIError)) return null;
  // SDK a rele chan an `requestID` (kamèl), pa `request_id`. Yon tès te
  // trape sa: san li, chak jounal t ap di `request_id: null` epi sipò
  // Anthropic pa t ap ka jwenn apèl la. Nou li antèt la tou kòm sekou, si
  // yon vèsyon SDK chanje non chan an ankò.
  const withId = err as { requestID?: string | null };
  if (withId.requestID) return withId.requestID;
  return err.headers?.get?.("request-id") ?? null;
}

/**
 * Mesaj pou admin nan. Chak youn di EGZAKTEMAN kote pou l ale epi kisa pou
 * l fè — se sa ki diferans ant « eseye ankò pita » (ki voye yon moun tann
 * yon bagay ki p ap rive) ak yon pàn ki pran de minit pou regle.
 */
const MESSAGES: Record<FailureKind, string> = {
  not_configured:
    "Sèvis AI a pa konfigire: kle ANTHROPIC_API_KEY pa prezan sou sèvè a. Ajoute l nan Vercel (Production) epi redeplwaye.",
  invalid_credentials:
    "Kle API Claude a refize (envalid oswa revoke). Kreye yon nouvo kle sou console.anthropic.com → API Keys, mete l nan Vercel, epi redeplwaye.",
  billing:
    "Kont API Claude a pa gen kredi. Ale sou console.anthropic.com → Billing pou ajoute kredi. Rès dashboard la kontinye mache nòmalman.",
  not_found:
    "Modèl Claude ki konfigire a pa egziste. Verifye ANTHROPIC_MODEL_FAST ak ANTHROPIC_MODEL_STRONG nan Vercel.",
  rate_limited: "Twòp demann bay Claude kounye a. Tanpri eseye ankò nan kèk minit.",
  timeout: "Claude pran twò lontan pou reponn. Tanpri eseye ankò.",
  network: "Nou pa ka jwenn sèvis AI a kounye a. Tanpri eseye ankò pita.",
  provider_error:
    "Sèvis AI a retounen yon erè nou pa rekonèt. Gade jounal sèvè a (chèche « [integration] anthropic ») pou detay la.",
};

/**
 * Klase yon erè Anthropic. Lòd la konte: chèk ki pi espesifik yo anvan.
 */
export function classifyAnthropicError(err: unknown): IntegrationFailure {
  const detail = errorText(err);
  const code = providerCode(err);
  const reqId = requestId(err);
  const make = (kind: FailureKind) =>
    integrationFailure({
      integration: "anthropic",
      kind,
      message: MESSAGES[kind],
      detail,
      providerCode: code,
      requestId: reqId,
    });

  if (err instanceof AiNotConfiguredError) return make("not_configured");

  // FAKTIRASYON ANVAN TOUT LÒT CHÈK HTTP. Anthropic voye sa a kòm yon 400
  // `invalid_request_error`, donk nenpòt chèk pa klas oswa pa estati ta
  // manke l epi rele l yon « move demand ».
  if (CREDIT_PATTERNS.some((p) => p.test(detail))) return make("billing");

  if (err instanceof Anthropic.AuthenticationError) return make("invalid_credentials");
  if (err instanceof Anthropic.PermissionDeniedError) return make("invalid_credentials");
  if (err instanceof Anthropic.NotFoundError) return make("not_found");
  if (err instanceof Anthropic.RateLimitError) return make("rate_limited");
  if (err instanceof Anthropic.APIConnectionTimeoutError) return make("timeout");
  if (err instanceof Anthropic.APIConnectionError) return make("network");
  if (err instanceof Anthropic.APIError) return make("provider_error");

  return make("provider_error");
}

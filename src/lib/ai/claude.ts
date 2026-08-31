import Anthropic from "@anthropic-ai/sdk";

/**
 * TACH 2 (ASISTAN AI ADMIN) — sèl kote ki pale dirèkteman ak SDK Anthropic
 * la. Chak apèl API Claude nan tout pwojè a dwe pase pa fonksyon ki nan
 * fichye sa a — si non/vèsyon modèl la chanje pita, se SÈLMAN isit la pou
 * touche. Sèvè sèlman (import "@anthropic-ai/sdk" pa gen okenn sans nan
 * yon bundle navigatè, e `process.env.ANTHROPIC_API_KEY` pa janm ekspoze
 * bay kliyan an).
 *
 * De modèl separe (demand eksplisit spec la, seksyon H): youn rapid/
 * ekonomik pou rezime jounalye yo (repete chak jou), youn pi solid pou
 * redaksyon (piblisite/mesaj, ki egzije pi bon jijman/kalite tèks).
 * Chak modèl konfigirab pa yon varyab anviwònman ki gen yon valè defo
 * san danje si l pa mete.
 */
export const MODEL_FAST = process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5";
export const MODEL_STRONG = process.env.ANTHROPIC_MODEL_STRONG || "claude-opus-5";

export class AiNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY pa konfigire sou sèvè a.");
    this.name = "AiNotConfiguredError";
  }
}

let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  if (!cachedClient) cachedClient = new Anthropic({ apiKey });
  return cachedClient;
}

/** True si kle a konfigire — UI a itilize sa pou deside afiche panèl la olye yon erè brit. */
export function isAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

type AskClaudeInput = {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
};

type AskClaudeResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

/** Apèl SAN streaming — itilize pou Feature 3 (piblisite, repons JSON kout, pa bezwen streaming). */
export async function askClaude({
  model,
  systemPrompt,
  userMessage,
  maxTokens = 2000,
}: AskClaudeInput): Promise<AskClaudeResult> {
  const client = getClient();
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model: response.model,
  };
}

type StreamClaudeResult = {
  /** Chak moso tèks li tape a, nan lòd — konsome l ak `for await`. */
  textStream: AsyncGenerator<string>;
  /** Rezoud sèlman apre stream la fini nèt — itilize l pou anrejistre nan ai_usage_log. */
  usage: Promise<{ inputTokens: number; outputTokens: number; model: string }>;
};

/** Apèl AK streaming (SSE) — Feature 1 (rezime), 2 (mesaj), 4 (priyorite): admin nan wè tèks la ap ekri. */
export function streamClaude({
  model,
  systemPrompt,
  userMessage,
  maxTokens = 4000,
}: AskClaudeInput): StreamClaudeResult {
  const client = getClient();
  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  async function* textStream() {
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }

  const usage = stream.finalMessage().then((m) => ({
    inputTokens: m.usage.input_tokens,
    outputTokens: m.usage.output_tokens,
    model: m.model,
  }));

  return { textStream: textStream(), usage };
}

/**
 * Tradui yon erè SDK Anthropic an mesaj Kreyòl klè pou UI a — jamè lage
 * mesaj brit anglè/estatistik HTTP bay admin nan. Chèk pi espesifik anvan
 * pi jeneral la, jan gid SDK a rekòmande.
 */
export function claudeErrorToKreyol(err: unknown): string {
  if (err instanceof AiNotConfiguredError) {
    return "Asistan AI a pa konfigire sou sèvè a kounye a. Rès dashboard la kontinye mache nòmalman.";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "Kle API Claude a envalid oswa ekspire. Kontakte yon devlopè pou verifye konfigirasyon an.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Twòp demann bay Claude kounye a. Tanpri eseye ankò nan kèk minit.";
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return "Claude pran twò lontan pou reponn. Tanpri eseye ankò.";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Pa gen koneksyon ak sèvis AI a kounye a. Tanpri eseye ankò pita.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Sèvis AI a retounen yon erè (${err.status}). Tanpri eseye ankò.`;
  }
  return "Yon erè enkoni rive ak asistan AI a. Tanpri eseye ankò.";
}

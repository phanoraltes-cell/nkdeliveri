/**
 * KLASIFIKASYON ECHÈK SÈVIS EKSTÈN.
 *
 * Poukisa fichye sa a egziste: `/api/admin/ai` te retounen yon 500 nu
 * pandan PLIZYÈ JOU. Vrè kòz la se te yon bagay ki pran de minit pou
 * regle — kont API a pa t gen kredi. Sa ki koute jou yo se pa pàn nan, se
 * de mesaj erè ki pa t di anyen: yon « 500 Internal Server Error » sou
 * ekran an, epi yon « Sèvis AI a retounen yon erè (400) » nan jounal la.
 *
 * Règ la kounye a: yon echèk sèvis ekstèn dwe reponn TWA kesyon, chak fwa.
 *
 *   1. KI SA KI PASE? — `kind`, yon kategori ki gen yon non.
 *   2. KISA POU M FÈ? — `message`, an Kreyòl, ak etap konkrè a ladan l.
 *      Pa « eseye ankò pita » lè pwoblèm nan se yon kont san kredi: sa a
 *      voye moun nan tann yon bagay ki p ap janm rive pou kont li.
 *   3. KI KOTE POU M GADE? — `detail`, `providerCode` ak `requestId` nan
 *      jounal sèvè a, pou yon devlopè ka rekonstwi apèl la ak sipò
 *      founisè a.
 *
 * Epi yon règ ki soti nan menm ensidan an: **kòd HTTP la dwe di verite a**.
 * Yon 500 vle di « nou kase »; yon kont san kredi PA yon bug nan kòd nou.
 * `FAILURE_STATUS` bay chak kategori kòd ki koresponn lan, konsa yon moun
 * ki gade Network tab la wè kisa k ap pase san li pa louvri jounal la.
 */

/** Chak sèvis ekstèn oswa konfigirasyon aplikasyon an depann de. */
export const INTEGRATIONS = [
  "anthropic",
  "plop",
  "moncash",
  "natcash",
  "stripe",
  "push",
  "sms",
  "storage",
] as const;

export type IntegrationId = (typeof INTEGRATIONS)[number];

/** Non lizib pou chak entegrasyon — sèvi nan mesaj ak nan ekran dyagnostik la. */
export const INTEGRATION_LABEL: Record<IntegrationId, string> = {
  anthropic: "Asistan AI (Claude)",
  plop: "PLOP (rechaj ak retrè)",
  moncash: "MonCash",
  natcash: "NatCash",
  stripe: "Stripe (kat kredi)",
  push: "Notifikasyon push (VAPID)",
  sms: "SMS",
  storage: "Depo fichye (Supabase Storage)",
};

/**
 * Kategori echèk yo. Lis la fèt EKSPRÈ kout: chak kategori dwe mennen sou
 * yon aksyon diferan. Si de kategori ta mande menm aksyon, yo ta dwe yon
 * sèl — yon distenksyon ki pa chanje anyen se bri.
 */
export type FailureKind =
  /** Varyab anviwònman an pa la ditou. Aksyon: konfigire l epi redeplwaye. */
  | "not_configured"
  /** Kle a la men founisè a refize l. Aksyon: jenere yon nouvo kle. */
  | "invalid_credentials"
  /** Kont founisè a pa gen kredi / fakturasyon bloke. Aksyon: peye. */
  | "billing"
  /** Resous la (modèl, kont, chemen) pa egziste. Aksyon: korije konfigirasyon an. */
  | "not_found"
  /** Twòp demann. Aksyon: tann. */
  | "rate_limited"
  /** Founisè a pran twò lontan. Aksyon: eseye ankò. */
  | "timeout"
  /** Nou pa ka menm rive jwenn founisè a. Aksyon: eseye ankò / tcheke rezo. */
  | "network"
  /** Tout lòt bagay founisè a retounen. Aksyon: gade jounal la. */
  | "provider_error";

/**
 * Kòd HTTP pa kategori.
 *
 * 402 pou fakturasyon se yon chwa delibere: li ra, epi se egzakteman sa l
 * vle di (« Payment Required »). Yon moun ki wè 402 nan Network tab la
 * konnen imedyatman se pa yon bug nan kòd la.
 */
export const FAILURE_STATUS: Record<FailureKind, number> = {
  not_configured: 503,
  invalid_credentials: 401,
  billing: 402,
  not_found: 502,
  rate_limited: 429,
  timeout: 504,
  network: 502,
  provider_error: 502,
};

export type IntegrationFailure = {
  integration: IntegrationId;
  kind: FailureKind;
  /** Kòd HTTP ki gen sans pou kategori a. */
  status: number;
  /** Mesaj pou moun nan — an Kreyòl, ak etap konkrè a ladan l. */
  message: string;
  /** Detay teknik POU JOUNAL LA SÈLMAN. Jamè nan yon repons HTTP. */
  detail: string;
  /** Kòd erè founisè a bay (`authentication_error`, `invalid_request_error`…). */
  providerCode: string | null;
  /** Idantifyan demand founisè a — sa sipò yo mande lè w ap ouvri yon tikè. */
  requestId: string | null;
};

/** Konstwi yon echèk ak kòd HTTP ki koresponn ak kategori a. */
export function integrationFailure(input: {
  integration: IntegrationId;
  kind: FailureKind;
  message: string;
  detail?: string;
  providerCode?: string | null;
  requestId?: string | null;
}): IntegrationFailure {
  return {
    integration: input.integration,
    kind: input.kind,
    status: FAILURE_STATUS[input.kind],
    message: input.message,
    detail: input.detail ?? "",
    providerCode: input.providerCode ?? null,
    requestId: input.requestId ?? null,
  };
}

/**
 * Ekri echèk la nan jounal sèvè a, an yon sèl liy JSON.
 *
 * Yon sèl liy strikire (pa yon objè Error ki gaye sou 20 liy) paske se
 * konsa yon moun ka chèche l nan jounal Vercel yo: `[integration]` epi non
 * sèvis la. `detail` ka gen mesaj founisè a — li pa janm gen yon kle,
 * paske klasifikatè yo pa janm mete youn ladan l.
 */
export function logIntegrationFailure(failure: IntegrationFailure): void {
  console.error(
    `[integration] ${JSON.stringify({
      integration: failure.integration,
      kind: failure.kind,
      status: failure.status,
      provider_code: failure.providerCode,
      request_id: failure.requestId,
      detail: failure.detail.slice(0, 500),
    })}`,
  );
}

/**
 * Sa yon echèk vle di an de mo — pou ekran « Eta sistèm nan ».
 */
export const FAILURE_KIND_LABEL: Record<FailureKind, string> = {
  not_configured: "Pa konfigire",
  invalid_credentials: "Kle refize",
  billing: "Kont san kredi",
  not_found: "Resous pa jwenn",
  rate_limited: "Twòp demann",
  timeout: "Tan mouri",
  network: "Pwoblèm rezo",
  provider_error: "Erè founisè",
};

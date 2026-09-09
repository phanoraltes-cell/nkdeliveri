/**
 * Google Identity Services (GIS) — chaje DINAMIKMAN sèlman lè yon paj rele
 * `getGoogleIdToken()` (paj konekte a), pa nan `index.html` glonbalman —
 * pou pa ajoute yon script ki pa itil pou tout LÒT paj sit la.
 *
 * Ranplase ansyen apwòch `supabase.auth.signInWithOAuth({provider:"google"})`
 * (yon redireksyon paj antye bay Google epi tounen) pou koneksyon PRENSIPAL
 * la (auth.index.tsx) — GIS bay yon ID token dirèkteman nan navigatè a (One
 * Tap), san redireksyon, epi `supabase.auth.signInWithIdToken({provider:
 * "google", token})` echanje l pou yon sesyon Supabase. Apelan an (paj
 * konekte a) DWE tonbe tounen sou `signInWithOAuth` si fonksyon sa a rejte
 * pou nenpòt rezon (script pa chaje, Client ID pa konfigire, One Tap
 * sispann/refize) — jamè kite itilizatè a san okenn mwayen konekte.
 *
 * REYITILIZASYON DELIBERE LIMITE: `useReauth.ts`/`admin-idle-lock.tsx` yo
 * itilize `signInWithOAuth` ak `prompt: "consent"` espre pou FÒSE yon vre
 * re-otantifikasyon (yon sesyon Google deja aktif pa dwe ka konplete san
 * enteraksyon) — yon flux "step-up" sekirite, pa yon senp koneksyon. GIS
 * One Tap ka silansyeu chwazi yon kont Google deja konekte san mande okenn
 * konfimasyon, ki ta AFEBLI egzijans sa a. Modil sa a rete SÈLMAN pou
 * koneksyon prensipal la — pa itilize l pou re-otantifikasyon/step-up.
 */

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GIS_LOAD_TIMEOUT_MS = 5000;
// Konbyen tan nou tann One Tap anvan nou tonbe sou sekou a. Li dwe ase
// long pou yon moun wè fenèt la epi klike (One Tap parèt nan yon segonn),
// men pa ase long pou bouton an parèt kase.
const GIS_PROMPT_TIMEOUT_MS = 12000;

type GisCredentialResponse = { credential?: string };
type GisPromptNotification = {
  // Opsyonèl EKSPRÈ: ak FedCM aktive, Google pa sipòte isNotDisplayed()
  // ni isSkippedMoment() ankò. Yo ka absan nèt.
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  // Google BAY rezon an — nou pa t ap li l anvan, se poutèt sa chak echèk
  // te parèt menm jan. `unregistered_origin` la se sa ki di ou origin nan
  // pa nan Google Cloud Console; san li, ou ka pase jou ap devine.
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
  getDismissedReason?: () => string;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GisCredentialResponse) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            use_fedcm_for_prompt?: boolean;
          }) => void;
          prompt: (momentListener?: (notification: GisPromptNotification) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

/**
 * `import.meta.env` — pa `process.env`. Vite ANBAKE varyab `VITE_*` yo nan
 * bundle la PANDAN BUILD LA: yo pa li nan moman egzekisyon. Konsekans ki
 * pyeje moun: ajoute varyab la nan Vercel PA ase — fòk gen yon NOUVO BUILD
 * apre sa. Yon redeplwaman san rebuild kite ansyen valè a (oswa vid) nan
 * bundle la.
 *
 * `?.trim()` epi tès vid: yon varyab ki egziste men ki vid (`VITE_...=`)
 * se menm bagay ak yon varyab ki absan — sa a se egzakteman ka `.env.example`
 * la, ki gen liy lan san valè.
 */
const RAW_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const GOOGLE_CLIENT_ID = RAW_CLIENT_ID?.trim() ? RAW_CLIENT_ID.trim() : undefined;

/** Kategori echèk GIS — chak youn mennen sou yon aksyon diferan. */
export type GoogleSignInFailureReason =
  | "not_configured"
  | "script_blocked"
  | "script_timeout"
  | "unregistered_origin"
  | "dismissed_by_user"
  | "no_google_session"
  | "prompt_ignored"
  | "unknown";

/** Kisa pou fè pou chak kategori — mesaj la ale nan konsòl la, pa sou paj piblik la. */
const REASON_HINT: Record<GoogleSignInFailureReason, string> = {
  not_configured:
    "VITE_GOOGLE_CLIENT_ID absan oswa vid nan bundle la. Ajoute l nan Vercel (Production) EPI redeplwaye — varyab VITE_ anbake pandan build la, yon restart pa ase.",
  script_blocked:
    "Script GIS la (accounts.google.com/gsi/client) pa t ka chaje — blokè piblisite, CSP, oswa rezo.",
  script_timeout: "Script GIS la pran twò lontan pou chaje. Rezo lan oswa Google an reta.",
  unregistered_origin:
    "Origin sa a pa otorize pou Client ID a. Google Cloud Console → Credentials → OAuth 2.0 Client ID → Authorized JavaScript origins: ajoute https://www.nkdeliveri.com AK https://nkdeliveri.com (epi http://localhost:5173 pou devlopman).",
  dismissed_by_user: "Itilizatè a fèmen One Tap la li menm — se pa yon pàn.",
  no_google_session:
    "Pa gen sesyon Google nan navigatè a, oswa moun nan te dezaktive One Tap. Sekou OAuth la se bon repons lan isit la.",
  prompt_ignored:
    "One Tap parèt men pèsonn pa reponn li nan delè a (oswa Google pa bay okenn moman ak FedCM). Sekou OAuth la se bon repons lan isit la.",
  unknown: "Rezon an pa idantifye — gade mesaj erè a ak konsòl Google la.",
};

/**
 * Erè GIS ki pote kòz la ak aksyon an, olye yon `Error` jenerik.
 *
 * Anvan, chak echèk — kle ki manke, origin ki pa otorize, moun ki fèmen
 * fenèt la — te bay menm `console.warn` la. Se poutèt sa bouton an te
 * "toujou pase pa ansyen chemen an" san moun pa konnen poukisa.
 */
export class GoogleSignInError extends Error {
  readonly reason: GoogleSignInFailureReason;
  readonly hint: string;
  /** Rezon brit Google bay la (`unregistered_origin`, `opt_out_or_no_session`…). */
  readonly googleReason: string | null;

  constructor(reason: GoogleSignInFailureReason, googleReason: string | null = null) {
    super(`GIS echwe: ${reason}${googleReason ? ` (${googleReason})` : ""}`);
    this.name = "GoogleSignInError";
    this.reason = reason;
    this.hint = REASON_HINT[reason];
    this.googleReason = googleReason;
  }
}

/** Tradui rezon brit Google bay la an youn nan kategori nou yo. */
export function mapGoogleReason(raw: string | undefined): GoogleSignInFailureReason {
  if (!raw) return "unknown";
  if (raw === "unregistered_origin" || raw === "invalid_client") return "unregistered_origin";
  if (raw === "opt_out_or_no_session" || raw === "suppressed_by_user") return "no_google_session";
  if (raw === "user_cancel" || raw === "tap_outside" || raw === "cancel_called") {
    return "dismissed_by_user";
  }
  return "unknown";
}

let scriptLoadPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("GIS mande yon navigatè"));
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error("Google Identity Services pran twò lontan pou chaje"));
    }, GIS_LOAD_TIMEOUT_MS);

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      clearTimeout(timeoutHandle);
      if (window.google?.accounts?.id) resolve();
      else reject(new Error("Google Identity Services chaje men objè a manke"));
    };
    script.onerror = () => {
      clearTimeout(timeoutHandle);
      reject(new Error("Google Identity Services pa t ka chaje"));
    };
    if (!existing) document.head.appendChild(script);
  }).catch((err) => {
    // Pèmèt yon nouvo tantativ pwochen fwa (pa kenbe yon echèk pou tout
    // rès sesyon paj la) — yon rezo ki reprann ta dwe ka reyisi apre sa.
    scriptLoadPromise = null;
    throw err;
  });

  return scriptLoadPromise;
}

/**
 * Jwenn yon ID token Google (One Tap) — rejte (jamè "pann") si nenpòt bagay
 * anpeche sa: script pa chaje, Client ID pa konfigire, oswa prompt la pa
 * afiche/itilizatè a refize/sispann li. Apelan an responsab pou tonbe
 * tounen sou `supabase.auth.signInWithOAuth` nan CHAK ka sa yo.
 */
export async function getGoogleIdToken(): Promise<string> {
  if (!GOOGLE_CLIENT_ID) {
    throw new GoogleSignInError("not_configured");
  }

  try {
    await loadGisScript();
  } catch (err) {
    const timedOut = err instanceof Error && /twò lontan/.test(err.message);
    throw new GoogleSignInError(timedOut ? "script_timeout" : "script_blocked");
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(promptTimeout);
      fn();
    };

    // GAD KONT BLOKAJ ETÈNÈL. `prompt()` rele moman-listener la SÈLMAN lè
    // One Tap pa parèt, sote, oswa fèmen. Si li PARÈT epi moun nan senpleman
    // inyore l, PA GEN okenn moman epi `callback` la pa janm rele — promès
    // la pa t ap janm rezoud, epi bouton an t ap rete « Ap redirije… » pou
    // tout tan. Yon delè fè nou tonbe sou sekou a olye nou pann.
    const promptTimeout = setTimeout(() => {
      settle(() => reject(new GoogleSignInError("prompt_ignored")));
    }, GIS_PROMPT_TIMEOUT_MS);

    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID!,
      // false — pa chwazi yon kont otomatikman san itilizatè a wè/konfime
      // anyen; sa ta sipriz moun nan sou yon aparèy pataje.
      auto_select: false,
      cancel_on_tap_outside: true,
      // FedCM — SE SA KI TE FÈ ONE TAP PA JANM PARÈT NAN CHROME.
      // Chrome ap retire cookies tyès pati; san opsyon sa a, GIS toujou
      // depann de yo epi navigatè a bloke One Tap an silans. Rezilta:
      // chak koneksyon tonbe sou sekou OAuth la, epi moun nan wè ekran
      // redireksyon Google la (ki montre domèn Supabase la) olye yon
      // fenèt One Tap sou pwòp sit la. Google mande opsyon sa a pou tout
      // nouvo entegrasyon.
      use_fedcm_for_prompt: true,
      callback: (response) => {
        settle(() => {
          if (response.credential) resolve(response.credential);
          else reject(new GoogleSignInError("unknown", "no_credential"));
        });
      },
    });

    window.google!.accounts.id.prompt((notification) => {
      // Nou mande Google POUKISA, olye nou jete tout ka yo ansanm —
      // `unregistered_origin` la se sa ki di konfigirasyon Google Cloud la
      // an kòz, pa kòd la.
      //
      // MEN ATANSYON: ak FedCM aktive, Google PA sipòte
      // `isNotDisplayed()` ni `isSkippedMoment()` ankò. Nou rele yo ak
      // `?.()` epi nou aksepte `undefined` — si yo absan, delè a pi wo a
      // se sa ki fè travay la. Se poutèt sa gad delè a pa opsyonèl.
      if (notification.isNotDisplayed?.()) {
        const raw = notification.getNotDisplayedReason?.();
        settle(() => reject(new GoogleSignInError(mapGoogleReason(raw), raw ?? null)));
        return;
      }
      if (notification.isSkippedMoment?.()) {
        const raw = notification.getSkippedReason?.();
        settle(() => reject(new GoogleSignInError(mapGoogleReason(raw), raw ?? null)));
        return;
      }
      if (notification.isDismissedMoment?.()) {
        const raw = notification.getDismissedReason?.();
        // `credential_returned` se yon fèmti NÒMAL: One Tap fèmen paske
        // koneksyon an reyisi. Callback la ap rezoud — pa rejte sou li.
        if (raw === "credential_returned") return;
        settle(() => reject(new GoogleSignInError(mapGoogleReason(raw), raw ?? null)));
      }
    });
  });
}

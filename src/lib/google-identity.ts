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

type GisCredentialResponse = { credential?: string };
type GisPromptNotification = {
  isNotDisplayed: () => boolean;
  isSkippedMoment: () => boolean;
  isDismissedMoment: () => boolean;
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
          }) => void;
          prompt: (momentListener?: (notification: GisPromptNotification) => void) => void;
          cancel: () => void;
        };
      };
    };
  }
}

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

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
    throw new Error("VITE_GOOGLE_CLIENT_ID pa konfigire");
  }

  await loadGisScript();

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    window.google!.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID!,
      // false — pa chwazi yon kont otomatikman san itilizatè a wè/konfime
      // anyen; sa ta sipriz moun nan sou yon aparèy pataje.
      auto_select: false,
      cancel_on_tap_outside: true,
      callback: (response) => {
        settled = true;
        if (response.credential) resolve(response.credential);
        else reject(new Error("Google pa retounen okenn kredansyèl"));
      },
    });
    window.google!.accounts.id.prompt((notification) => {
      if (settled) return;
      if (
        notification.isNotDisplayed() ||
        notification.isSkippedMoment() ||
        notification.isDismissedMoment()
      ) {
        reject(new Error("Google One Tap pa afiche oswa itilizatè a fèmen li"));
      }
    });
  });
}

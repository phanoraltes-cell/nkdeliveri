const DISMISS_KEY = "nk_push_prompt_dismissed_at";
const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Never re-show the "why notifications" explanation right after the user dismissed it. */
export function canShowPermissionPrompt(): boolean {
  if (typeof window === "undefined") return false;
  const last = localStorage.getItem(DISMISS_KEY);
  if (!last) return true;
  return Date.now() - Number(last) > COOLDOWN_MS;
}

export function recordPermissionPromptDismissal(): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
}

/** Same instructions text used by notification-permission-denied-help.tsx, kept here so both know about each other's shape. */
export type BrowserGuide = { name: string; steps: string[] };

export function detectBrowserGuide(): BrowserGuide {
  const ua = navigator.userAgent;
  if (/edg\//i.test(ua)) {
    return {
      name: "Edge",
      steps: [
        "Klike sou ikòn kadna a bò kote adrès sit la anlè navigatè a",
        'Chwazi "Pèmisyon pou sit la"',
        'Mete "Notifikasyon" sou "Otorize"',
        "Rechaje paj la",
      ],
    };
  }
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) {
    return {
      name: "Chrome",
      steps: [
        "Klike sou ikòn kadna a (oswa ⓘ) bò kote adrès sit la",
        'Chwazi "Paramèt sit la"',
        'Mete "Notifikasyon" sou "Otorize"',
        "Rechaje paj la",
      ],
    };
  }
  if (/firefox\//i.test(ua)) {
    return {
      name: "Firefox",
      steps: [
        "Klike sou ikòn kadna a bò kote adrès sit la",
        'Klike sou flèch la bò kote "Notifikasyon bloke"',
        'Chwazi "Retire blokaj la"',
        "Rechaje paj la",
      ],
    };
  }
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) {
    return {
      name: "Safari",
      steps: [
        "Louvri Anviwònman Safari (Safari Settings)",
        'Ale nan "Sit Entènèt" → "Notifikasyon"',
        'Jwenn nkdeliveri.com epi mete l sou "Otorize"',
        "Rechaje paj la",
      ],
    };
  }
  return {
    name: "Navigatè w",
    steps: [
      "Louvri paramèt navigatè a",
      'Jwenn seksyon "Notifikasyon" oswa "Pèmisyon sit"',
      "Otorize notifikasyon pou nkdeliveri.com",
      "Rechaje paj la",
    ],
  };
}

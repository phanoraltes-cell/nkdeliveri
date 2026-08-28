import { useCallback, useEffect, useRef, useState } from "react";

/**
 * SEC-003 remediation (audit/findings.jsonl) — every public, unauthenticated
 * Supabase Auth call this app makes (sign-in, sign-up, password-reset
 * request) can otherwise be called directly against GoTrue with the public
 * anon key, bypassing this app's own RPC-based rate limit
 * (check_auth_rate_limit_secure) entirely, since that check happens in a
 * separate request the attacker's script never has to make. Supabase Auth's
 * own "Enable CAPTCHA protection" setting (Dashboard → Authentication →
 * Attack Protection, configured with a Cloudflare Turnstile secret key) is
 * what actually closes that bypass — it rejects any signInWithPassword/
 * signUp/resetPasswordForEmail call missing a valid captchaToken, and that
 * check runs entirely server-side inside GoTrue. This hook only produces
 * the token to send; it enforces nothing by itself.
 *
 * No-ops (renders nothing, token stays null forever) when
 * VITE_TURNSTILE_SITE_KEY isn't set — e.g. local dev without the secret
 * configured — so every call site keeps working exactly as before this
 * remediation (falling back to app-level rate limiting only) instead of
 * being blocked by a widget that can never load. Mirrors the same
 * env-var-gated, safe-to-omit pattern already used for Sentry
 * (src/lib/sentry-browser.ts).
 *
 * No npm dependency added — the official @marsidev/react-turnstile wrapper
 * (or Cloudflare's own) would work too, but the vanilla script + explicit
 * render API is a handful of lines and this project already prefers that
 * over a new dependency for a small integration (see the C-01 CI step's
 * own "no new dependency" comment for the same reasoning elsewhere).
 */

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptLoadPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile script failed to load"));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

export function useTurnstile() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !containerRef.current) return;
    let cancelled = false;

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (t) => setToken(t),
          "expired-callback": () => setToken(null),
          "error-callback": () => setToken(null),
        });
      })
      .catch((e) => console.error("[turnstile] failed to load", e));

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, []);

  // Turnstile tokens are single-use — call after any submit attempt (success
  // or failure) that consumed the current token, so the widget issues a
  // fresh one for a possible retry instead of silently failing again.
  const reset = useCallback(() => {
    setToken(null);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  return { containerRef, token, reset, enabled: !!SITE_KEY };
}

import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { toast } from "sonner";
import { noIndexMeta } from "@/lib/seo";
import { translateAuthError, isEmailNotConfirmedError } from "@/lib/auth-errors";
import { inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTurnstile } from "@/hooks/useTurnstile";
import { getGoogleIdToken, GoogleSignInError } from "@/lib/google-identity";
import { FieldError } from "@/components/ui/field-error";

const searchSchema = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth/")({
  validateSearch: searchSchema,
  head: () => noIndexMeta("Konekte — NK Deliveri"),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const search = useSearch({ from: "/auth/" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Endikatè DEV SÈLMAN — li pa janm parèt sou paj piblik la (wè
  // import.meta.env.DEV kote li mete a). Objektif la se pou yon devlopè
  // wè rezon an san li pa louvri konsòl la.
  const [googleDiagnostic, setGoogleDiagnostic] = useState<string | null>(null);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  // F-04 (docs/archive/audits/FRONTEND_GLOBAL_AUDIT.md §25) — sign-in failures used to
  // reach the user through a toast only. Kept, but also rendered inline
  // (role="alert") so a screen-reader user who misses the timed toast still
  // sees why the form didn't submit.
  const [loginError, setLoginError] = useState<string | null>(null);
  const captcha = useTurnstile();

  useEffect(() => {
    // Surface OAuth failures (e.g. user cancelled consent, provider
    // misconfigured) that Supabase reports back as URL params, then strip
    // them so a refresh doesn't re-show the same error.
    const params = new URLSearchParams(
      window.location.hash ? window.location.hash.slice(1) : window.location.search,
    );
    const oauthError = params.get("error_description") || params.get("error");
    if (oauthError) {
      toast.error("Erè koneksyon: " + oauthError.replace(/\+/g, " "));
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search.split("#")[0],
      );
    }

    // Redirect immediately if already signed in...
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: search.next || "/dashboard" });
    });
    // ...and also once the OAuth redirect finishes exchanging its code for a
    // session — getSession() above can race ahead of that exchange.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) nav({ to: search.next || "/dashboard" });
    });
    return () => sub.subscription.unsubscribe();
  }, [nav, search.next]);

  // Metòd prensipal: Google Identity Services (One Tap) → ID token →
  // supabase.auth.signInWithIdToken — pa gen redireksyon paj antye ankò.
  // Ansyen metòd la (signInGoogleOAuthFallback pi ba) rete kòm SEKOU:
  // yon echèk GIS (script pa chaje, Client ID pa konfigire, One Tap
  // sispann/refize) tonbe tounen otomatikman sou redireksyon OAuth la, pou
  // bouton an pa janm rete san reyaksyon.
  async function signInGoogle() {
    setGoogleLoading(true);
    try {
      const idToken = await getGoogleIdToken();
      const { error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: idToken,
      });
      if (error) throw error;
      toast.success("Byenveni!");
      nav({ to: search.next || "/dashboard" });
      setGoogleLoading(false);
    } catch (err) {
      // SEKOU A PA DWE KACHE RAZON AN. Anvan, chak echèk — kle ki manke,
      // origin ki pa otorize, moun ki fèmen fenèt la — te bay menm
      // `console.warn` la, epi flit la te glise sou redireksyon OAuth la
      // an silans. Se sa ki fè bouton an te parèt "toujou pase pa ansyen
      // chemen an" san pèsonn pa konnen poukisa.
      const reason = err instanceof GoogleSignInError ? err.reason : "unknown";
      const hint = err instanceof GoogleSignInError ? err.hint : String(err);
      const googleReason = err instanceof GoogleSignInError ? err.googleReason : null;
      // `console.error`, pa `warn`: `warn` disparèt nan bri konsòl la.
      console.error(
        `[auth] GIS pa mache — rezon: ${reason}${googleReason ? ` (Google: ${googleReason})` : ""}. ${hint} Sekou: redireksyon OAuth.`,
      );
      // Yon moun ki fèmen One Tap la li menm pa yon pàn — pa bezwen mete
      // yon endikatè sou ekran an pou sa.
      if (import.meta.env.DEV && reason !== "dismissed_by_user") {
        setGoogleDiagnostic(hint);
      }
      const redirecting = await signInGoogleOAuthFallback();
      // Redireksyon an ap kite paj la nan yon ti moman — kenbe bouton an
      // "Ap redirije…" olye l retounen enabled pandan yon ti eklè anvan sa
      // (menm konpòtman ak ansyen kòd la). Yon echèk konplè (tou de metòd)
      // reactive bouton an pou moun nan ka eseye ankò.
      if (!redirecting) setGoogleLoading(false);
    }
  }

  /** @returns true si redireksyon an lanse san erè (bouton an rete "loading" jiskaske paj la chanje). */
  async function signInGoogleOAuthFallback(): Promise<boolean> {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/auth" },
    });
    if (error) {
      toast.error("Erè Google: " + error.message);
      return false;
    }
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNeedsConfirmation(false);
    setLoginError(null);
    try {
      const { data: allowed, error: rlErr } = await supabase.rpc("check_auth_rate_limit_secure", {
        _email: email.trim(),
        _action: "sign_in",
        _max_hits: 8,
        _window_seconds: 600,
      });
      if (rlErr) throw rlErr;
      if (!allowed) throw new Error("Too many sign-in attempts — rate limit exceeded");

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: { captchaToken: captcha.token ?? undefined },
      });
      if (error) throw error;
      toast.success("Byenveni!");
      nav({ to: search.next || "/dashboard" });
    } catch (e) {
      const message = translateAuthError(e);
      setLoginError(message);
      toast.error(message);
      if (isEmailNotConfirmedError(e)) setNeedsConfirmation(true);
    } finally {
      setLoading(false);
      captcha.reset();
    }
  }

  async function resendConfirmation() {
    if (!email.trim()) {
      toast.error("Antre imèl ou anwo a dabò");
      return;
    }
    setResending(true);
    try {
      const { data: allowed, error: rlErr } = await supabase.rpc("check_auth_rate_limit_secure", {
        _email: email.trim(),
        _action: "resend_confirmation",
        _max_hits: 3,
        _window_seconds: 600,
      });
      if (rlErr) throw rlErr;
      if (!allowed) throw new Error("Too many confirmation resend requests — rate limit exceeded");

      const { error } = await supabase.auth.resend({ type: "signup", email: email.trim() });
      if (error) throw error;
      toast.success("Nou voye yon nouvo imèl konfimasyon. Tcheke bwat ou (ak spam).");
    } catch (e) {
      toast.error(translateAuthError(e));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-md px-5 py-12">
        <div className="rounded-3xl bg-white p-8 shadow-brand-md ring-1 ring-brand-soft/40">
          <h1 className="mb-2 font-display text-2xl font-extrabold">Konekte</h1>
          <p className="mb-6 text-sm text-ink-soft">
            Antre nan kont ou pou kòmande oswa aksede dashboard w.
          </p>

          {import.meta.env.DEV && googleDiagnostic && (
            <p
              role="alert"
              className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
            >
              [DEV] Google: {googleDiagnostic}
            </p>
          )}
          <button
            onClick={signInGoogle}
            disabled={googleLoading}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-full border-2 border-brand-soft bg-white px-5 py-3 font-semibold transition hover:-translate-y-0.5 hover:border-brand hover:shadow-brand-xs disabled:pointer-events-none disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            {googleLoading ? "Ap redirije…" : "Kontinye ak Google"}
          </button>

          <div className="mb-4 flex items-center gap-3 text-xs text-ink-soft">
            <div className="h-px flex-1 bg-brand-soft" /> oswa{" "}
            <div className="h-px flex-1 bg-brand-soft" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {loginError && (
              <p
                role="alert"
                className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
              >
                {loginError}
              </p>
            )}
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              aria-label="Email"
              aria-invalid={!!loginError}
              className={inputCls()}
            />
            <div>
              <input
                required
                type="password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Modpas"
                aria-label="Modpas"
                aria-invalid={!!loginError}
                className={inputCls()}
              />
              <div className="mt-1.5 text-right">
                <Link
                  to="/auth/forgot-password"
                  className="text-xs font-semibold text-brand-deep hover:underline"
                >
                  Bliye modpas ou?
                </Link>
              </div>
            </div>
            <div ref={captcha.containerRef} className="flex justify-center" />
            <Button className="h-auto w-full py-3" disabled={loading}>
              {loading ? "..." : "Konekte"}
            </Button>
          </form>

          {needsConfirmation && (
            <div className="mt-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>Kont ou pa konfime. Tcheke imèl ou, oswa:</p>
              <button
                onClick={resendConfirmation}
                disabled={resending}
                className="mt-2 inline-flex h-9 items-center rounded-full bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {resending ? "Ap voye…" : "Voye imèl konfimasyon an ankò"}
              </button>
            </div>
          )}

          <div className="mt-6 rounded-xl bg-brand-soft/40 p-4 text-center text-sm">
            Pa gen yon kont?{" "}
            <Link to="/auth/register" className="font-bold text-brand-deep hover:underline">
              Kreye yon kont
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

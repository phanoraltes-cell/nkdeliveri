import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { toast } from "sonner";
import { noIndexMeta } from "@/lib/seo";
import { translateAuthError } from "@/lib/auth-errors";
import { Mail } from "lucide-react";
import { inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTurnstile } from "@/hooks/useTurnstile";
import { FieldError } from "@/components/ui/field-error";

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => noIndexMeta("Reyinisyalize modpas — NK Deliveri"),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // F-04 (docs/archive/audits/FRONTEND_GLOBAL_AUDIT.md §25) — both were toast-only before.
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const captcha = useTurnstile();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setEmailError(null);
    setFormError(null);
    if (!email.trim()) {
      setEmailError("Antre imèl ou");
      return toast.error("Antre imèl ou");
    }
    setLoading(true);
    try {
      const { data: allowed, error: rlErr } = await supabase.rpc("check_auth_rate_limit_secure", {
        _email: email.trim(),
        _action: "reset_password_request",
        _max_hits: 3,
        _window_seconds: 600,
      });
      if (rlErr) throw rlErr;
      if (!allowed) throw new Error("Too many password reset requests — rate limit exceeded");

      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + "/auth/reset-password",
        captchaToken: captcha.token ?? undefined,
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      const message = translateAuthError(e);
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
      captcha.reset();
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-md px-5 py-12">
        <div className="rounded-3xl bg-white p-8 shadow-brand-md ring-1 ring-brand-soft/40">
          <h1 className="mb-2 font-display text-2xl font-extrabold">Bliye modpas ou?</h1>

          {sent ? (
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <Mail className="mb-2 h-5 w-5" />
              Si yon kont egziste ak <b>{email}</b>, ou pral resevwa yon imèl ak yon lyen pou chwazi
              yon nouvo modpas. Tcheke bwat ou (ak spam).
            </div>
          ) : (
            <>
              <p className="mb-6 text-sm text-ink-soft">
                Antre imèl kont ou. Nou ap voye yon lyen pou reyinisyalize modpas ou.
              </p>
              <form onSubmit={submit} className="space-y-3">
                {formError && (
                  <p
                    role="alert"
                    className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                  >
                    {formError}
                  </p>
                )}
                <div>
                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    placeholder="Email"
                    aria-label="Email"
                    aria-invalid={!!emailError}
                    aria-describedby={emailError ? "forgot-email-error" : undefined}
                    className={inputCls()}
                  />
                  <FieldError id="forgot-email-error" message={emailError} />
                </div>
                <div ref={captcha.containerRef} className="flex justify-center" />
                <Button className="h-auto w-full py-3" disabled={loading}>
                  {loading ? "Ap voye…" : "Voye lyen an"}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 text-center text-sm text-ink-soft">
            <Link to="/auth" className="font-bold text-brand-deep hover:underline">
              ← Retounen konekte
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

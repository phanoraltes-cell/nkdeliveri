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

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => noIndexMeta("Reyinisyalize modpas — NK Deliveri"),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const captcha = useTurnstile();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return toast.error("Antre imèl ou");
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
      toast.error(translateAuthError(e));
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
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  aria-label="Email"
                  className={inputCls()}
                />
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

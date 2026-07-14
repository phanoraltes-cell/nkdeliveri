import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { toast } from "sonner";
import { noIndexMeta } from "@/lib/seo";
import { translateAuthError } from "@/lib/auth-errors";
import { Mail } from "lucide-react";

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => noIndexMeta("Reyinisyalize modpas — NK Deliveri"),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: window.location.origin + "/auth/reset-password",
      });
      if (error) throw error;
      setSent(true);
    } catch (e) {
      toast.error(translateAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-md px-5 py-12">
        <div className="rounded-[18px] bg-white p-8 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
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
                  className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
                />
                <button
                  disabled={loading}
                  className="w-full rounded-full bg-brand py-3 font-bold text-white transition hover:bg-brand-deep disabled:opacity-50"
                >
                  {loading ? "Ap voye…" : "Voye lyen an"}
                </button>
              </form>
            </>
          )}

          <div className="mt-6 text-center text-sm text-ink-soft">
            <Link to="/auth" className="font-bold text-brand-deep hover:underline">
              ← Retounen konekte
            </Link>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

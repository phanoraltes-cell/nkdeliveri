import { createFileRoute, useNavigate, useSearch, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { toast } from "sonner";

const searchSchema = z.object({ next: z.string().optional() });

export const Route = createFileRoute("/auth/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Konekte — NK Delivery" }] }),
  component: LoginPage,
});

function LoginPage() {
  const nav = useNavigate();
  const search = useSearch({ from: "/auth/" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: (search.next as any) || "/dashboard" });
    });
  }, [nav, search.next]);

  async function signInGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
    });
    if ((result as any).error) toast.error("Erè Google: " + (result as any).error.message);
  }

  async function signInApple() {
    const result = await lovable.auth.signInWithOAuth("apple", {
      redirect_uri: window.location.origin + "/auth",
    });
    if ((result as any).error) toast.error("Erè Apple: " + (result as any).error.message);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Byenveni!");
      nav({ to: (search.next as any) || "/dashboard" });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-md px-5 py-12">
        <div className="rounded-[18px] bg-white p-8 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
          <h1 className="mb-2 font-display text-2xl font-extrabold">Konekte</h1>
          <p className="mb-6 text-sm text-ink-soft">Antre nan kont ou pou kòmande oswa aksede dashboard w.</p>

          <button
            onClick={signInGoogle}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-full border-2 border-brand-soft bg-white px-5 py-3 font-semibold transition hover:bg-brand-soft"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Kontinye ak Google
          </button>

          <button
            onClick={signInApple}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-full border-2 border-black bg-black px-5 py-3 font-semibold text-white transition hover:bg-neutral-800"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16.365 1.43c0 1.14-.44 2.23-1.16 3.03-.78.87-2.04 1.55-3.08 1.47-.13-1.1.4-2.24 1.1-3.02.79-.9 2.13-1.56 3.14-1.48zM20.5 17.4c-.55 1.27-.82 1.84-1.53 2.96-.99 1.55-2.39 3.48-4.12 3.5-1.54.02-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.02-3.05-1.76-4.04-3.31C.02 16.16-.29 10.98 1.76 8.23c1.46-1.96 3.76-3.1 5.92-3.1 2.2 0 3.59 1.2 5.41 1.2 1.77 0 2.85-1.2 5.4-1.2 1.93 0 3.98 1.05 5.44 2.87-4.78 2.62-4 9.44-3.43 9.4z"/></svg>
            Kontinye ak Apple
          </button>

          <div className="mb-4 flex items-center gap-3 text-xs text-ink-soft">
            <div className="h-px flex-1 bg-brand-soft" /> oswa <div className="h-px flex-1 bg-brand-soft" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
              className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand" />
            <input required type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Modpas"
              className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand" />
            <button disabled={loading}
              className="w-full rounded-full bg-brand py-3 font-bold text-white transition hover:bg-brand-deep disabled:opacity-50">
              {loading ? "..." : "Konekte"}
            </button>
          </form>

          <div className="mt-6 rounded-xl bg-brand-soft/40 p-4 text-center text-sm">
            Pa gen yon kont?{" "}
            <Link to="/auth/register" className="font-bold text-brand-deep hover:underline">
              Kreye yon kont
            </Link>
          </div>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
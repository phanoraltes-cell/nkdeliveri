import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
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
  component: AuthPage,
});

function AuthPage() {
  const nav = useNavigate();
  const search = useSearch({ from: "/auth" });
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: (search.next as any) || "/" });
    });
  }, [nav, search.next]);

  async function signInGoogle() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if ((result as any).error) toast.error("Erè Google: " + (result as any).error.message);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Byenveni!");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { first_name: firstName },
          },
        });
        if (error) throw error;
        toast.success("Kont ou kreye! Verifye email w.");
      }
      nav({ to: (search.next as any) || "/" });
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
          <h1 className="mb-2 font-display text-2xl font-extrabold">
            {mode === "login" ? "Konekte" : "Kreye yon kont"}
          </h1>
          <p className="mb-6 text-sm text-ink-soft">
            {mode === "login" ? "Antre nan kont ou pou kòmande." : "Kreye yon kont pou kòmanse kòmande."}
          </p>

          <button
            onClick={signInGoogle}
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-full border-2 border-brand-soft bg-white px-5 py-3 font-semibold transition hover:bg-brand-soft"
          >
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Kontinye ak Google
          </button>

          <div className="mb-4 flex items-center gap-3 text-xs text-ink-soft">
            <div className="h-px flex-1 bg-brand-soft" /> oswa <div className="h-px flex-1 bg-brand-soft" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {mode === "signup" && (
              <input
                required
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Non ou"
                className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
              />
            )}
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
            />
            <input
              required
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Modpas (6+ karaktè)"
              className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
            />
            <button
              disabled={loading}
              className="w-full rounded-full bg-brand py-3 font-bold text-white transition hover:bg-brand-deep disabled:opacity-50"
            >
              {loading ? "..." : mode === "login" ? "Konekte" : "Kreye kont mwen"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="mt-4 w-full text-center text-sm text-brand-deep hover:underline"
          >
            {mode === "login" ? "Pa gen yon kont? Enskri" : "Deja gen yon kont? Konekte"}
          </button>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
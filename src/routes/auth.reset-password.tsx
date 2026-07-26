import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { toast } from "sonner";
import { noIndexMeta } from "@/lib/seo";
import { translateAuthError } from "@/lib/auth-errors";
import { inputCls } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => noIndexMeta("Chwazi nouvo modpas — NK Deliveri"),
  component: ResetPassword,
});

function ResetPassword() {
  const nav = useNavigate();
  // Supabase exchanges the recovery link's token for a session automatically
  // on load (PKCE/hash detection) and fires PASSWORD_RECOVERY once ready —
  // until then we don't know if this visit came from a real link or someone
  // just typing the URL, so show a neutral "checking" state rather than a
  // form that would fail confusingly.
  const [ready, setReady] = useState<"checking" | "ready" | "invalid">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady("ready");
    });
    // If a session already exists by the time this mounts (e.g. fast token
    // exchange before the listener attached), that also means we're good.
    supabase.auth.getSession().then(({ data }) => {
      setReady((cur) => (cur === "checking" ? (data.session ? "ready" : "invalid") : cur));
    });
    const timeout = window.setTimeout(() => {
      setReady((cur) => (cur === "checking" ? "invalid" : cur));
    }, 4000);
    return () => {
      sub.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Modpas yo pa menm");
      return;
    }
    if (password.length < 6) {
      toast.error("Modpas la dwe gen omwen 6 karaktè");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Revoke every other session/device — this recovery session becomes
      // the one trusted session; any session that existed before the
      // password reset (e.g. an attacker's, if that's why the user reset
      // it) must not survive. `scope: "others"` keeps this session logged
      // in. Best-effort: the password change itself already succeeded.
      await supabase.auth.signOut({ scope: "others" }).catch((e) => {
        console.error("[auth] signOut(others) after password reset failed", e);
      });
      setDone(true);
      toast.success("Modpas ou chanje avèk siksè!");
      setTimeout(() => nav({ to: "/dashboard" }), 1200);
    } catch (e) {
      toast.error(translateAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-md px-5 py-12">
        <div className="rounded-3xl bg-white p-8 shadow-brand-md ring-1 ring-brand-soft/40">
          <h1 className="mb-2 font-display text-2xl font-extrabold">Chwazi nouvo modpas</h1>

          {ready === "checking" && <p className="text-sm text-ink-soft">Ap verifye lyen an…</p>}

          {ready === "invalid" && (
            <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 text-sm text-red-900">
              Lyen sa a envalid oswa li ekspire. Mande yon nouvo lyen.
              <div className="mt-3">
                <Link
                  to="/auth/forgot-password"
                  className="font-bold text-brand-deep hover:underline"
                >
                  Mande yon nouvo lyen →
                </Link>
              </div>
            </div>
          )}

          {ready === "ready" && !done && (
            <form onSubmit={submit} className="space-y-3">
              <input
                required
                type="password"
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Nouvo modpas"
                aria-label="Nouvo modpas"
                className={inputCls()}
              />
              <input
                required
                type="password"
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Konfime nouvo modpas"
                aria-label="Konfime nouvo modpas"
                className={inputCls()}
              />
              <Button className="h-auto w-full py-3" disabled={loading}>
                {loading ? "..." : "Chanje modpas"}
              </Button>
            </form>
          )}

          {done && (
            <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Modpas ou chanje! N ap voye w nan dashboard w.
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

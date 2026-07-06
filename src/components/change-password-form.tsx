import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { translateAuthError } from "@/lib/auth-errors";
import { KeyRound } from "lucide-react";

/**
 * Password change for an already-authenticated user. Supabase's updateUser()
 * doesn't require re-entering the current password when there's a live
 * session (same as most account-settings screens) — no separate
 * "verify old password" round-trip needed.
 */
export function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) return toast.error("Modpas yo pa menm");
    if (password.length < 6) return toast.error("Modpas la dwe gen omwen 6 karaktè");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Modpas ou chanje avèk siksè");
      setPassword("");
      setConfirm("");
    } catch (e) {
      toast.error(translateAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          type="password"
          required
          minLength={6}
          placeholder="Nouvo modpas"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
        <input
          type="password"
          required
          minLength={6}
          placeholder="Konfime nouvo modpas"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand"
        />
      </div>
      <button
        disabled={loading}
        className="inline-flex h-11 items-center gap-1.5 rounded-full bg-brand px-5 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
      >
        <KeyRound className="h-4 w-4" /> {loading ? "Ap chanje…" : "Chanje modpas"}
      </button>
    </form>
  );
}

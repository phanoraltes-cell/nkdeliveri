import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { translateAuthError } from "@/lib/auth-errors";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputCls } from "@/lib/utils";
import { FieldError } from "@/components/ui/field-error";

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
  // F-04 (docs/FRONTEND_GLOBAL_AUDIT.md §25) — all three were toast-only.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [passwordLenError, setPasswordLenError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setConfirmError(null);
    setPasswordLenError(null);
    setFormError(null);
    if (password !== confirm) {
      setConfirmError("Modpas yo pa menm");
      return toast.error("Modpas yo pa menm");
    }
    if (password.length < 6) {
      setPasswordLenError("Modpas la dwe gen omwen 6 karaktè");
      return toast.error("Modpas la dwe gen omwen 6 karaktè");
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // Revoke every other session/device now that the password has
      // changed — `scope: "others"` leaves this current session (the one
      // that just proved it knows the new password) untouched, native
      // Supabase Auth mechanism, no custom session bookkeeping needed.
      // Best-effort: the password change itself already succeeded, so a
      // failure here shouldn't surface as if the password change failed.
      await supabase.auth.signOut({ scope: "others" }).catch((e) => {
        console.error("[auth] signOut(others) after password change failed", e);
      });
      toast.success("Modpas ou chanje avèk siksè");
      setPassword("");
      setConfirm("");
    } catch (e) {
      const message = translateAuthError(e);
      setFormError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {formError && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
        >
          {formError}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <input
            type="password"
            required
            minLength={6}
            placeholder="Nouvo modpas"
            aria-label="Nouvo modpas"
            aria-invalid={!!passwordLenError}
            aria-describedby={passwordLenError ? "change-password-len-error" : undefined}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (passwordLenError) setPasswordLenError(null);
            }}
            className={inputCls()}
          />
          <FieldError id="change-password-len-error" message={passwordLenError} />
        </div>
        <div>
          <input
            type="password"
            required
            minLength={6}
            placeholder="Konfime nouvo modpas"
            aria-label="Konfime nouvo modpas"
            aria-invalid={!!confirmError}
            aria-describedby={confirmError ? "change-confirm-error" : undefined}
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              if (confirmError) setConfirmError(null);
            }}
            className={inputCls()}
          />
          <FieldError id="change-confirm-error" message={confirmError} />
        </div>
      </div>
      <Button disabled={loading}>
        <KeyRound className="h-4 w-4" /> {loading ? "Ap chanje…" : "Chanje modpas"}
      </Button>
    </form>
  );
}

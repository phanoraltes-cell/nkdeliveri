import { useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { inputCls } from "@/lib/utils";
import { baseSignUp } from "./register-shared.logic";
import { useSubmit } from "@/hooks/useSubmit";
import { FormCard } from "./register-shared";
import { Button } from "@/components/ui/button";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";
import { useTurnstile } from "@/hooks/useTurnstile";
import { FieldError } from "@/components/ui/field-error";

export function CustomerForm() {
  const [f, setF] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
    confirm: "",
    address: "",
    terms: false,
  });
  // F-04 (docs/FRONTEND_GLOBAL_AUDIT.md §25) — these two checks used to be
  // toast-only. Kept as toasts (unchanged UX) but now also tracked here so
  // the offending field gets aria-invalid + a visible inline message.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const { loading, error, wrap } = useSubmit(() => {});
  const captcha = useTurnstile();
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setConfirmError(null);
    setTermsError(null);
    if (f.password !== f.confirm) {
      setConfirmError("Modpas yo pa menm");
      return toast.error("Modpas yo pa menm");
    }
    if (!f.terms) {
      setTermsError("Ou dwe aksepte kondisyon yo");
      return toast.error("Ou dwe aksepte kondisyon yo");
    }
    wrap(
      () =>
        baseSignUp(
          f.email,
          f.password,
          {
            account_type: "customer",
            first_name: f.firstName,
            last_name: f.lastName,
            phone: f.phone,
            address: f.address,
            // NKD-022: only sent because the checkbox below is required to
            // submit (line above) — handle_new_user() stamps
            // profiles.terms_accepted_at from this, never unconditionally.
            terms_version: CURRENT_TERMS_VERSION,
          },
          captcha.token ?? undefined,
        ),
      "Kont kliyan ou kreye!",
    ).finally(() => captcha.reset());
  }
  return (
    <FormCard>
      <form onSubmit={submit} className="space-y-3">
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
          >
            {error}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            required
            placeholder="Prenon"
            aria-label="Prenon"
            className={inputCls()}
            value={f.firstName}
            onChange={(e) => setF({ ...f, firstName: e.target.value })}
          />
          <input
            required
            placeholder="Non"
            aria-label="Non"
            className={inputCls()}
            value={f.lastName}
            onChange={(e) => setF({ ...f, lastName: e.target.value })}
          />
        </div>
        <input
          required
          type="email"
          placeholder="Email"
          aria-label="Email"
          className={inputCls()}
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <input
          required
          type="tel"
          placeholder="Telefòn (+509...)"
          aria-label="Telefòn (+509...)"
          className={inputCls()}
          value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value })}
        />
        <input
          placeholder="Adrès prensipal (opsyonèl)"
          aria-label="Adrès prensipal (opsyonèl)"
          className={inputCls()}
          value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            required
            type="password"
            minLength={6}
            placeholder="Modpas"
            aria-label="Modpas"
            className={inputCls()}
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
          <div>
            <input
              required
              type="password"
              minLength={6}
              placeholder="Konfime modpas"
              aria-label="Konfime modpas"
              aria-invalid={!!confirmError}
              aria-describedby={confirmError ? "customer-confirm-error" : undefined}
              className={inputCls()}
              value={f.confirm}
              onChange={(e) => {
                setF({ ...f, confirm: e.target.value });
                if (confirmError) setConfirmError(null);
              }}
            />
            <FieldError id="customer-confirm-error" message={confirmError} />
          </div>
        </div>
        <div>
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={f.terms}
              aria-invalid={!!termsError}
              aria-describedby={termsError ? "customer-terms-error" : undefined}
              onChange={(e) => {
                setF({ ...f, terms: e.target.checked });
                if (termsError) setTermsError(null);
              }}
              className="mt-1"
            />
            <span>
              Mwen aksepte{" "}
              <Link
                to="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-deep underline"
              >
                Kondisyon Itilizasyon
              </Link>{" "}
              ak{" "}
              <Link
                to="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-deep underline"
              >
                Politik Konfidansyalite
              </Link>{" "}
              NK Deliveri.
            </span>
          </label>
          <FieldError id="customer-terms-error" message={termsError} />
        </div>
        <div ref={captcha.containerRef} className="flex justify-center" />
        <Button className="h-auto w-full py-3" disabled={loading}>
          {loading ? "..." : "Kreye kont kliyan"}
        </Button>
      </form>
    </FormCard>
  );
}

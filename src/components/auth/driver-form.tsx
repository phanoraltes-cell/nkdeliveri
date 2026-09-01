import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { finalizeRegistrationDocuments } from "@/lib/register-documents.functions";
import { inputCls } from "@/lib/utils";
import { baseSignUp, toFileInput } from "./register-shared.logic";
import { useSubmit } from "@/hooks/useSubmit";
import { FormCard, FileField } from "./register-shared";
import { Button } from "@/components/ui/button";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";
import { useTurnstile } from "@/hooks/useTurnstile";
import { FieldError } from "@/components/ui/field-error";

export function DriverForm() {
  const [f, setF] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    address: "",
    vehicleType: "",
    licensePlate: "",
    password: "",
    confirm: "",
    terms: false,
  });
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const [license, setLicense] = useState<File | null>(null);
  const [vehiclePhoto, setVehiclePhoto] = useState<File | null>(null);
  // F-04 (docs/FRONTEND_GLOBAL_AUDIT.md §25) — these three checks used to be
  // toast-only. Kept as toasts (unchanged UX) but now also tracked here so
  // the offending field gets a visible inline message.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [idDocError, setIdDocError] = useState<string | null>(null);
  const { loading, error, wrap } = useSubmit(() => {});
  const captcha = useTurnstile();
  const finalizeDocs = useServerFn(finalizeRegistrationDocuments);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setConfirmError(null);
    setTermsError(null);
    setIdDocError(null);
    if (f.password !== f.confirm) {
      setConfirmError("Modpas yo pa menm");
      return toast.error("Modpas yo pa menm");
    }
    if (!f.terms) {
      setTermsError("Ou dwe aksepte kondisyon yo");
      return toast.error("Ou dwe aksepte kondisyon yo");
    }
    if (!idDoc) {
      setIdDocError("Foto pyès idantite w obligatwa");
      return toast.error("Foto pyès idantite w obligatwa");
    }
    wrap(async () => {
      const { userId, hasSession } = await baseSignUp(
        f.email,
        f.password,
        {
          account_type: "driver",
          first_name: f.firstName,
          last_name: f.lastName,
          phone: f.phone,
          address: f.address,
          vehicle_type: f.vehicleType,
          license_plate: f.licensePlate,
          // NKD-022: only sent because the checkbox below is required to
          // submit (line above) — handle_new_user() stamps
          // profiles.terms_accepted_at from this, never unconditionally.
          terms_version: CURRENT_TERMS_VERSION,
        },
        captcha.token ?? undefined,
      );
      // Runs server-side with the service role — the ID document (required
      // for admin approval) is never silently dropped if email confirmation
      // is pending or the browser closes right after signup. Its own
      // try/catch: the account is already created by this point (baseSignUp
      // above succeeded), so a document upload failure must never turn into
      // the red "registration failed" toast below — that used to happen
      // because both awaits shared one try/catch, hiding a real account
      // creation behind an unrelated storage error. Documents are required
      // for approval, so this failure still needs to reach the driver, just
      // without contradicting the "your account exists" message.
      try {
        await finalizeDocs({
          data: {
            userId,
            email: f.email,
            accountType: "driver",
            files: {
              idDoc: await toFileInput(idDoc),
              license: license ? await toFileInput(license) : undefined,
              vehiclePhoto: vehiclePhoto ? await toFileInput(vehiclePhoto) : undefined,
            },
          },
        });
      } catch (e) {
        console.warn("[register] driver documents upload failed post-signup", e);
        toast.warning(
          "Kont livrè ou kreye, men nou pa t kapab telechaje dokiman ou yo. San yo, nou p ap ka apwouve kont ou — kontakte sipò.",
        );
      }
      return { hasSession };
    }, "Kont livrè kreye! An atant valdasyon.").finally(() => captcha.reset());
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
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            required
            type="tel"
            placeholder="Telefòn"
            aria-label="Telefòn"
            className={inputCls()}
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
          <input
            required
            type="email"
            placeholder="Email"
            aria-label="Email"
            className={inputCls()}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </div>
        <input
          required
          placeholder="Adrès"
          aria-label="Adrès"
          className={inputCls()}
          value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            required
            aria-label="Tip veyikil"
            className={inputCls()}
            value={f.vehicleType}
            onChange={(e) => setF({ ...f, vehicleType: e.target.value })}
          >
            <option value="">Tip veyikil</option>
            <option value="moto">Moto</option>
            <option value="bicycle">Bekàn</option>
            <option value="car">Machin</option>
            <option value="scooter">Scooter</option>
          </select>
          <input
            placeholder="Nimewo plak (si li aplikab)"
            aria-label="Nimewo plak (si li aplikab)"
            className={inputCls()}
            value={f.licensePlate}
            onChange={(e) => setF({ ...f, licensePlate: e.target.value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <FileField
              label="Pyès idantite *"
              accept="image/*,application/pdf"
              onChange={(f) => {
                setIdDoc(f);
                if (idDocError) setIdDocError(null);
              }}
            />
            <FieldError id="driver-iddoc-error" message={idDocError} />
          </div>
          <FileField
            label="Pèmi (opsyonèl)"
            accept="image/*,application/pdf"
            onChange={setLicense}
          />
          <FileField label="Foto veyikil (opsyonèl)" accept="image/*" onChange={setVehiclePhoto} />
        </div>

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
              aria-describedby={confirmError ? "driver-confirm-error" : undefined}
              className={inputCls()}
              value={f.confirm}
              onChange={(e) => {
                setF({ ...f, confirm: e.target.value });
                if (confirmError) setConfirmError(null);
              }}
            />
            <FieldError id="driver-confirm-error" message={confirmError} />
          </div>
        </div>
        <div>
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={f.terms}
              aria-invalid={!!termsError}
              aria-describedby={termsError ? "driver-terms-error" : undefined}
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
              NK Deliveri kòm livrè.
            </span>
          </label>
          <FieldError id="driver-terms-error" message={termsError} />
        </div>
        <div ref={captcha.containerRef} className="flex justify-center" />
        <Button className="h-auto w-full py-3" disabled={loading}>
          {loading ? "..." : "Kreye kont livrè"}
        </Button>
        <p className="text-center text-xs text-ink-soft">
          Kont ou ap atann valdasyon yon administratè.
        </p>
      </form>
    </FormCard>
  );
}

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
import { HoursPicker, type WeeklyHours } from "@/components/hours-picker";
import { buildRestaurantHoursMetadata } from "./restaurant-form.logic";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";
import { useTurnstile } from "@/hooks/useTurnstile";
import { FieldError } from "@/components/ui/field-error";

export function RestaurantForm() {
  const [f, setF] = useState({
    ownerName: "",
    restaurantName: "",
    description: "",
    cuisine: "",
    phone: "",
    email: "",
    address: "",
    password: "",
    confirm: "",
    terms: false,
  });
  // Kept separate from `f`/metadata's Record<string,string> shape — this
  // needs to reach restaurants.opening_hours (jsonb) in the exact
  // Record<dayKey,{open,close,closed}> shape the rest of the app already
  // uses (dashboard.restaurant.profile.tsx, update_restaurant_hours_secure),
  // never as free text. Starts empty and stays empty unless the owner
  // actually touches a day row (HoursPicker only ever writes the days it's
  // told to) — an untouched picker sends nothing, same as before this fix
  // (docs/DRIVER_RESTAURANT_REGISTRATION_REMEDIATION_REPORT.md).
  const [hours, setHours] = useState<WeeklyHours>({});
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  // F-04 (docs/FRONTEND_GLOBAL_AUDIT.md §25) — these two checks used to be
  // toast-only. Kept as toasts (unchanged UX) but now also tracked here so
  // the offending field gets aria-invalid + a visible inline message.
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const { loading, error, wrap } = useSubmit(() => {});
  const captcha = useTurnstile();
  const finalizeDocs = useServerFn(finalizeRegistrationDocuments);

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
    wrap(async () => {
      const { userId, hasSession } = await baseSignUp(
        f.email,
        f.password,
        {
          account_type: "restaurant",
          first_name: f.ownerName,
          phone: f.phone,
          restaurant_name: f.restaurantName,
          restaurant_description: f.description,
          restaurant_cuisine: f.cuisine,
          restaurant_address: f.address,
          ...buildRestaurantHoursMetadata(hours),
          // NKD-022: only sent because the checkbox below is required to
          // submit (line above) — handle_new_user() stamps
          // profiles.terms_accepted_at from this, never unconditionally.
          terms_version: CURRENT_TERMS_VERSION,
        },
        captcha.token ?? undefined,
      );
      // Runs server-side with the service role — works even without a
      // client session, so logo/cover are never silently lost when email
      // confirmation is pending. Its own try/catch: the account is already
      // created by this point (baseSignUp above succeeded), so a logo/cover
      // upload failure must never turn into the red "registration failed"
      // toast below — that used to happen because both awaits shared one
      // try/catch, hiding a real account creation behind an unrelated
      // storage error.
      if (logo || cover) {
        try {
          await finalizeDocs({
            data: {
              userId,
              email: f.email,
              accountType: "restaurant",
              files: {
                logo: logo ? await toFileInput(logo) : undefined,
                cover: cover ? await toFileInput(cover) : undefined,
              },
            },
          });
        } catch (e) {
          console.warn("[register] logo/cover upload failed post-signup", e);
          toast.warning(
            "Kont restoran ou kreye, men nou pa t kapab telechaje logo/foto kouvèti a. Kontakte sipò pou ajoute yo.",
          );
        }
      }
      return { hasSession };
    }, "Restoran w kreye! Kont ou an atant valdasyon.").finally(() => captcha.reset());
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
        <input
          required
          placeholder="Non pwopriyetè"
          aria-label="Non pwopriyetè"
          className={inputCls()}
          value={f.ownerName}
          onChange={(e) => setF({ ...f, ownerName: e.target.value })}
        />
        <input
          required
          placeholder="Non restoran"
          aria-label="Non restoran"
          className={inputCls()}
          value={f.restaurantName}
          onChange={(e) => setF({ ...f, restaurantName: e.target.value })}
        />
        <textarea
          placeholder="Deskripsyon"
          aria-label="Deskripsyon"
          rows={3}
          className={inputCls()}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            required
            placeholder="Kategori (ex: Kreyòl, Fritay)"
            aria-label="Kategori (ex: Kreyòl, Fritay)"
            className={inputCls()}
            value={f.cuisine}
            onChange={(e) => setF({ ...f, cuisine: e.target.value })}
          />
          <input
            required
            type="tel"
            placeholder="Telefòn"
            aria-label="Telefòn"
            className={inputCls()}
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
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
          placeholder="Adrès konplè"
          aria-label="Adrès konplè"
          className={inputCls()}
          value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })}
        />
        <div>
          <span className="mb-1.5 block text-xs font-bold uppercase text-ink-soft">
            Orè ouvèti (opsyonèl — ou ka ranpli sa pita nan pwofil ou)
          </span>
          <HoursPicker value={hours} onChange={setHours} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FileField label="Logo" accept="image/*" onChange={setLogo} />
          <FileField label="Foto kouvèti" accept="image/*" onChange={setCover} />
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
              aria-describedby={confirmError ? "restaurant-confirm-error" : undefined}
              className={inputCls()}
              value={f.confirm}
              onChange={(e) => {
                setF({ ...f, confirm: e.target.value });
                if (confirmError) setConfirmError(null);
              }}
            />
            <FieldError id="restaurant-confirm-error" message={confirmError} />
          </div>
        </div>
        <div>
          <label className="flex items-start gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={f.terms}
              aria-invalid={!!termsError}
              aria-describedby={termsError ? "restaurant-terms-error" : undefined}
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
              patenarya ak platfòm NK Deliveri.
            </span>
          </label>
          <FieldError id="restaurant-terms-error" message={termsError} />
        </div>
        <div ref={captcha.containerRef} className="flex justify-center" />
        <Button className="h-auto w-full py-3" disabled={loading}>
          {loading ? "..." : "Kreye kont restoran"}
        </Button>
        <p className="text-center text-xs text-ink-soft">
          Kont ou ap atann valdasyon yon administratè.
        </p>
      </form>
    </FormCard>
  );
}

import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { finalizeRegistrationDocuments } from "@/lib/register-documents.functions";
import { inputCls } from "@/lib/utils";
import { baseSignUp, toFileInput, useSubmit, FormCard, FileField } from "./register-shared";

export function RestaurantForm() {
  const [f, setF] = useState({
    ownerName: "",
    restaurantName: "",
    description: "",
    cuisine: "",
    phone: "",
    email: "",
    address: "",
    hours: "",
    password: "",
    confirm: "",
    terms: false,
  });
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const { loading, wrap } = useSubmit(() => {});
  const finalizeDocs = useServerFn(finalizeRegistrationDocuments);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) return toast.error("Modpas yo pa menm");
    if (!f.terms) return toast.error("Ou dwe aksepte kondisyon yo");
    wrap(async () => {
      const { userId, hasSession } = await baseSignUp(f.email, f.password, {
        account_type: "restaurant",
        first_name: f.ownerName,
        phone: f.phone,
        restaurant_name: f.restaurantName,
        restaurant_description: f.description,
        restaurant_cuisine: f.cuisine,
        restaurant_address: f.address,
      });
      // Runs server-side with the service role — works even without a
      // client session, so logo/cover are never silently lost when email
      // confirmation is pending.
      if (logo || cover) {
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
      }
      return { hasSession };
    }, "Restoran w kreye! Kont ou an atant valdasyon.");
  }

  return (
    <FormCard>
      <form onSubmit={submit} className="space-y-3">
        <input
          required
          placeholder="Non pwopriyetè"
          className={inputCls()}
          value={f.ownerName}
          onChange={(e) => setF({ ...f, ownerName: e.target.value })}
        />
        <input
          required
          placeholder="Non restoran"
          className={inputCls()}
          value={f.restaurantName}
          onChange={(e) => setF({ ...f, restaurantName: e.target.value })}
        />
        <textarea
          placeholder="Deskripsyon"
          rows={3}
          className={inputCls()}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            required
            placeholder="Kategori (ex: Kreyòl, Fritay)"
            className={inputCls()}
            value={f.cuisine}
            onChange={(e) => setF({ ...f, cuisine: e.target.value })}
          />
          <input
            required
            type="tel"
            placeholder="Telefòn"
            className={inputCls()}
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
        </div>
        <input
          required
          type="email"
          placeholder="Email"
          className={inputCls()}
          value={f.email}
          onChange={(e) => setF({ ...f, email: e.target.value })}
        />
        <input
          required
          placeholder="Adrès konplè"
          className={inputCls()}
          value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })}
        />
        <input
          placeholder="Orè ouvèti (ex: Lendi-Sam 10h-22h)"
          className={inputCls()}
          value={f.hours}
          onChange={(e) => setF({ ...f, hours: e.target.value })}
        />

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
            className={inputCls()}
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
          <input
            required
            type="password"
            minLength={6}
            placeholder="Konfime modpas"
            className={inputCls()}
            value={f.confirm}
            onChange={(e) => setF({ ...f, confirm: e.target.value })}
          />
        </div>
        <label className="flex items-start gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={f.terms}
            onChange={(e) => setF({ ...f, terms: e.target.checked })}
            className="mt-1"
          />
          <span>Mwen aksepte kondisyon patenarya ak platfòm NK Deliveri.</span>
        </label>
        <button
          disabled={loading}
          className="w-full rounded-full bg-brand py-3 font-bold text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "..." : "Kreye kont restoran"}
        </button>
        <p className="text-center text-xs text-ink-soft">
          Kont ou ap atann valdasyon yon administratè.
        </p>
      </form>
    </FormCard>
  );
}

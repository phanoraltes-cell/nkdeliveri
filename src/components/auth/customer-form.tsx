import { useState } from "react";
import { toast } from "sonner";
import { inputCls } from "@/lib/utils";
import { baseSignUp, useSubmit, FormCard } from "./register-shared";

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
  const { loading, wrap } = useSubmit(() => {});
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) return toast.error("Modpas yo pa menm");
    if (!f.terms) return toast.error("Ou dwe aksepte kondisyon yo");
    wrap(
      () =>
        baseSignUp(f.email, f.password, {
          account_type: "customer",
          first_name: f.firstName,
          last_name: f.lastName,
          phone: f.phone,
          address: f.address,
        }),
      "Kont kliyan ou kreye!",
    );
  }
  return (
    <FormCard>
      <form onSubmit={submit} className="space-y-3">
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
          <input
            required
            type="password"
            minLength={6}
            placeholder="Konfime modpas"
            aria-label="Konfime modpas"
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
          <span>
            Mwen aksepte <a className="text-brand-deep underline">Kondisyon Itilizasyon</a> ak{" "}
            <a className="text-brand-deep underline">Politik Konfidansyalite</a>.
          </span>
        </label>
        <button
          disabled={loading}
          className="w-full rounded-full bg-brand py-3 font-bold text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "..." : "Kreye kont kliyan"}
        </button>
      </form>
    </FormCard>
  );
}

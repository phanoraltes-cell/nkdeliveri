import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { finalizeRegistrationDocuments } from "@/lib/register-documents.functions";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { toast } from "sonner";
import { User, Store, Bike, ArrowLeft, Upload, type LucideIcon } from "lucide-react";
import { noIndexMeta } from "@/lib/seo";
import { translateAuthError } from "@/lib/auth-errors";
import { inputCls } from "@/lib/utils";

export const Route = createFileRoute("/auth/register")({
  head: () => noIndexMeta("Kreye yon kont — NK Deliveri"),
  component: RegisterPage,
});

type AccountType = "customer" | "restaurant" | "driver";

function RegisterPage() {
  const [type, setType] = useState<AccountType | null>(null);

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-5 py-10">
        <div className="mb-6 flex items-center gap-3">
          {type && (
            <button
              onClick={() => setType(null)}
              className="inline-flex items-center gap-1 rounded-full border border-brand-soft bg-white px-3 py-2.5 text-sm font-semibold text-brand-deep hover:bg-brand-soft/40"
            >
              <ArrowLeft className="h-4 w-4" /> Retounen
            </button>
          )}
          <div>
            <h1 className="font-display text-3xl font-extrabold text-ink">Kreye yon kont</h1>
            <p className="text-sm text-ink-soft">
              {type ? "Ranpli enfòmasyon w yo pou kontinye." : "Chwazi tip kont ou vle kreye a."}
            </p>
          </div>
        </div>

        {!type && <TypeSelector onSelect={setType} />}
        {type === "customer" && <CustomerForm />}
        {type === "restaurant" && <RestaurantForm />}
        {type === "driver" && <DriverForm />}

        <div className="mt-6 text-center text-sm text-ink-soft">
          Deja gen yon kont?{" "}
          <Link to="/auth" className="font-bold text-brand-deep hover:underline">
            Konekte
          </Link>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

function TypeSelector({ onSelect }: { onSelect: (t: AccountType) => void }) {
  const options: { type: AccountType; icon: LucideIcon; title: string; desc: string }[] = [
    {
      type: "customer",
      icon: User,
      title: "\u00a0Kliyan",
      desc: "Kòmande manje nan restoran favori w yo.",
    },
    {
      type: "restaurant",
      icon: Store,
      title: "Restoran",
      desc: "Vann plat ou yo sou NK Deliveri.",
    },
    { type: "driver", icon: Bike, title: "\u00a0Livrè", desc: "Ranpòte lajan nan livre manje." },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {options.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.type}
            onClick={() => onSelect(o.type)}
            className="group flex flex-col items-start rounded-2xl border-2 border-brand-soft/60 bg-white p-5 text-left shadow-brand-xs transition hover:-translate-y-1 hover:border-brand hover:shadow-brand-lg"
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep group-hover:bg-brand group-hover:text-white">
              <Icon className="h-6 w-6" />
            </div>
            <div className="font-display text-lg font-bold text-ink">{o.title}</div>
            <div className="mt-1 text-sm text-ink-soft">{o.desc}</div>
          </button>
        );
      })}
    </div>
  );
}

async function baseSignUp(email: string, password: string, data: Record<string, string>) {
  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: window.location.origin + "/dashboard",
      data,
    },
  });
  if (error) throw error;
  // signUpData.user is populated immediately even when email confirmation is
  // required and no session exists yet — never derive the id from a
  // follow-up getUser() call, which returns null without an active session.
  if (!signUpData.user) throw new Error("Kreyasyon kont lan echwe");
  return { userId: signUpData.user.id, hasSession: !!signUpData.session };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function useSubmit(onDone: () => void) {
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  async function wrap(fn: () => Promise<{ hasSession: boolean }>, successMsg: string) {
    setLoading(true);
    try {
      const { hasSession } = await fn();
      onDone();
      if (hasSession) {
        toast.success(successMsg);
        nav({ to: "/dashboard" });
      } else {
        toast.success(successMsg + " Tcheke imèl ou pou konfime kont ou anvan w konekte.");
        nav({ to: "/auth" });
      }
    } catch (e) {
      toast.error(translateAuthError(e));
    } finally {
      setLoading(false);
    }
  }
  return { loading, wrap };
}

function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-brand-md ring-1 ring-brand-soft/40 sm:p-8">
      {children}
    </div>
  );
}

// ---------------- CUSTOMER ----------------
function CustomerForm() {
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
            className={inputCls()}
            value={f.firstName}
            onChange={(e) => setF({ ...f, firstName: e.target.value })}
          />
          <input
            required
            placeholder="Non"
            className={inputCls()}
            value={f.lastName}
            onChange={(e) => setF({ ...f, lastName: e.target.value })}
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
          type="tel"
          placeholder="Telefòn (+509...)"
          className={inputCls()}
          value={f.phone}
          onChange={(e) => setF({ ...f, phone: e.target.value })}
        />
        <input
          placeholder="Adrès prensipal (opsyonèl)"
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

// ---------------- RESTAURANT ----------------
async function toFileInput(file: File) {
  return { name: file.name, type: file.type, base64: await fileToBase64(file) };
}

function RestaurantForm() {
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

// ---------------- DRIVER ----------------
function DriverForm() {
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
  const { loading, wrap } = useSubmit(() => {});
  const finalizeDocs = useServerFn(finalizeRegistrationDocuments);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.confirm) return toast.error("Modpas yo pa menm");
    if (!f.terms) return toast.error("Ou dwe aksepte kondisyon yo");
    if (!idDoc) return toast.error("Foto pyès idantite w obligatwa");
    wrap(async () => {
      const { userId, hasSession } = await baseSignUp(f.email, f.password, {
        account_type: "driver",
        first_name: f.firstName,
        last_name: f.lastName,
        phone: f.phone,
        address: f.address,
        vehicle_type: f.vehicleType,
        license_plate: f.licensePlate,
      });
      // Runs server-side with the service role — the ID document (required
      // for admin approval) is never silently dropped if email confirmation
      // is pending or the browser closes right after signup.
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
      return { hasSession };
    }, "Kont livrè kreye! An atant valdasyon.");
  }

  return (
    <FormCard>
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            required
            placeholder="Prenon"
            className={inputCls()}
            value={f.firstName}
            onChange={(e) => setF({ ...f, firstName: e.target.value })}
          />
          <input
            required
            placeholder="Non"
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
            className={inputCls()}
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
          <input
            required
            type="email"
            placeholder="Email"
            className={inputCls()}
            value={f.email}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
        </div>
        <input
          required
          placeholder="Adrès"
          className={inputCls()}
          value={f.address}
          onChange={(e) => setF({ ...f, address: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <select
            required
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
            className={inputCls()}
            value={f.licensePlate}
            onChange={(e) => setF({ ...f, licensePlate: e.target.value })}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <FileField label="Pyès idantite *" accept="image/*,application/pdf" onChange={setIdDoc} />
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
          <span>Mwen aksepte kondisyon livrè NK Deliveri.</span>
        </label>
        <button
          disabled={loading}
          className="w-full rounded-full bg-brand py-3 font-bold text-white shadow-brand-sm transition hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md disabled:pointer-events-none disabled:opacity-50"
        >
          {loading ? "..." : "Kreye kont livrè"}
        </button>
        <p className="text-center text-xs text-ink-soft">
          Kont ou ap atann valdasyon yon administratè.
        </p>
      </form>
    </FormCard>
  );
}

function FileField({
  label,
  accept,
  onChange,
}: {
  label: string;
  accept: string;
  onChange: (f: File | null) => void;
}) {
  const [name, setName] = useState<string>("");
  return (
    <label className="flex cursor-pointer flex-col items-start gap-1 rounded-xl border-2 border-dashed border-brand-soft bg-brand-soft/20 px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/40">
      <span className="font-semibold text-ink">{label}</span>
      <span className="flex items-center gap-1 text-brand-deep">
        <Upload className="h-3.5 w-3.5" /> {name || "Chwazi yon fichye"}
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          setName(file?.name ?? "");
          onChange(file);
        }}
      />
    </label>
  );
}

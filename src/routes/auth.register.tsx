import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { User, Store, Bike, ArrowLeft, type LucideIcon } from "lucide-react";
import { noIndexMeta } from "@/lib/seo";
import { CustomerForm } from "@/components/auth/customer-form";
import { RestaurantForm } from "@/components/auth/restaurant-form";
import { DriverForm } from "@/components/auth/driver-form";

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
      <main className="mx-auto max-w-2xl px-5 py-10">
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
      </main>
      <SiteFooter />
    </div>
  );
}

function TypeSelector({ onSelect }: { onSelect: (t: AccountType) => void }) {
  const options: { type: AccountType; icon: LucideIcon; title: string; desc: string }[] = [
    {
      type: "customer",
      icon: User,
      title: " Kliyan",
      desc: "Kòmande manje nan restoran favori w yo.",
    },
    {
      type: "restaurant",
      icon: Store,
      title: "Restoran",
      desc: "Vann plat ou yo sou NK Deliveri.",
    },
    { type: "driver", icon: Bike, title: " Livrè", desc: "Ranpòte lajan nan livre manje." },
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
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep group-hover:bg-brand-deep group-hover:text-white">
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

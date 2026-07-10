import { createFileRoute, Link } from "@tanstack/react-router";
import { Store, ClipboardList, Package, BarChart3, Users, Percent, Clock, Wallet, type LucideIcon } from "lucide-react";
import { useMyRestaurant } from "@/hooks/useMyRestaurant";

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/")({
  component: RestaurantDashboard,
});

type Tile = { icon: LucideIcon; title: string; desc: string; to: string | null };

function RestaurantDashboard() {
  const { user } = Route.useRouteContext();
  const { data: restaurant, isLoading } = useMyRestaurant(user?.id);

  const pending = restaurant?.status === "pending";
  const isOwner = restaurant?.isOwner ?? false;

  const ownerTiles: Tile[] = [
    { icon: ClipboardList, title: "Kòmand", desc: "Konfime, refize, swiv estati an tan reyèl", to: "/dashboard/restaurant/orders" },
    { icon: Package, title: "Meni", desc: "Kategori, plat ak foto", to: "/dashboard/restaurant/menu" },
    { icon: BarChart3, title: "Revni", desc: "Vant, komisyon ak istwa peman", to: "/dashboard/restaurant/revenue" },
    { icon: Wallet, title: "Peman ak Komisyon", desc: "Nimewo MonCash/NatCash, mòd + komisyon", to: "/dashboard/restaurant/payouts" },
    { icon: Percent, title: "Pwomosyon", desc: "Ofri espesyal", to: "/dashboard/restaurant/promotions" },
    { icon: Store, title: "Pwofil restoran", desc: "Enfo, logo, kouvèti, orè ouvèti", to: "/dashboard/restaurant/profile" },
    { icon: Users, title: "Anplwaye", desc: "Ajoute manm ekip la", to: "/dashboard/restaurant/employees" },
  ];
  const staffTiles: Tile[] = [
    { icon: ClipboardList, title: "Kòmand", desc: "Konfime, refize, swiv estati an tan reyèl", to: "/dashboard/restaurant/orders" },
    { icon: Package, title: "Meni", desc: "Kategori, plat ak foto", to: "/dashboard/restaurant/menu" },
  ];
  const tiles = isOwner ? ownerTiles : staffTiles;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">
            {restaurant?.name ?? "Restoran mwen"}
          </h1>
          <p className="mt-1 text-ink-soft">
            {isOwner ? "Jere manje w, kòmand ak vant ou yo." : "Jere kòmand ak meni restoran an."}
          </p>
        </div>
        {restaurant && isOwner && (
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
              pending
                ? "bg-amber-100 text-amber-800"
                : restaurant.status === "approved"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            {restaurant.status}
          </span>
        )}
      </div>

      {isLoading && <div className="text-ink-soft">Chajman...</div>}

      {isOwner && pending && (
        <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
          <div className="flex items-center gap-2 font-bold text-amber-900">
            <Clock className="h-5 w-5" /> Kont ou an atant valdasyon
          </div>
          <p className="mt-1 text-sm text-amber-800">
            Yon administratè ap revize enfòmasyon restoran ou. Ou pral resevwa yon email lè kont ou apwouve. Nan
            entèval, ou ka konplete pwofil ou ak menu ou.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((c) => {
          const Icon = c.icon;
          const body = (
            <div
              key={c.title}
              className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-display text-base font-bold text-ink">{c.title}</div>
              <div className="mt-1 text-sm text-ink-soft">{c.desc}</div>
              <div className="mt-3 text-xs font-semibold uppercase tracking-wider text-brand-deep">
                {c.to ? "Ouvri →" : "Byento"}
              </div>
            </div>
          );
          return c.to ? (
            <Link key={c.title} to={c.to} className="block">{body}</Link>
          ) : body;
        })}
      </div>
    </div>
  );
}

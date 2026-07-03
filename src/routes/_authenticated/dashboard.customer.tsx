import { createFileRoute, Link } from "@tanstack/react-router";
import { ShoppingBag, MapPin, CreditCard, Bell, Star, User } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/customer")({
  component: CustomerDashboard,
});

const CARDS = [
  { icon: User, title: "Pwofil mwen", desc: "Modifye enfòmasyon pèsonèl", to: "/profile" },
  { icon: MapPin, title: "Adrès mwen", desc: "Jere adrès livrezon yo", to: "/profile" },
  { icon: ShoppingBag, title: "Kòmand mwen", desc: "Wè istwa ak kòmand aktyèl", to: "/orders" },
  { icon: CreditCard, title: "Peman mwen", desc: "Jere metòd peman yo", to: "/profile" },
  { icon: Star, title: "Avi mwen", desc: "Wè epi kite avi", to: "/orders" },
  { icon: Bell, title: "Notifikasyon", desc: "Alèt kòmand ak pwomosyon", to: "/profile" },
];

function CustomerDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold text-ink">Byenveni! 👋</h1>
        <p className="mt-1 text-ink-soft">Kòmande manje w epi swiv livrezon w yo.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.title}
              to={c.to}
              className="group rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand hover:shadow-md"
            >
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep group-hover:bg-brand group-hover:text-white">
                <Icon className="h-5 w-5" />
              </div>
              <div className="font-display text-base font-bold text-ink">{c.title}</div>
              <div className="mt-1 text-sm text-ink-soft">{c.desc}</div>
            </Link>
          );
        })}
      </div>
      <Link
        to="/restaurants"
        className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-3 font-bold text-white shadow-md hover:bg-brand-deep"
      >
        <ShoppingBag className="h-4 w-4" /> Kòmande kounye a
      </Link>
    </div>
  );
}
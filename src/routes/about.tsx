import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta } from "@/lib/seo";
import { PRIMARY_CITY } from "@/lib/site-config";
import { Store, Bike, Users } from "lucide-react";

export const Route = createFileRoute("/about")({
  head: () =>
    pageMeta({
      title: "Apwopo NK Deliveri",
      description:
        "NK Deliveri konekte restoran, kliyan ak livrè nan Gonaïves pou yon sèvis livrezon manje rapid, fyab, ak peman lokal (MonCash, NatCash, kach).",
      path: "/about",
    }),
  component: About,
});

function About() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="mb-3 font-display text-3xl font-extrabold text-ink">Apwopo NK Deliveri</h1>
        <p className="text-ink-soft">
          NK Deliveri se yon platfòm livrezon manje ki konekte restoran lokal yo ak kliyan nan{" "}
          {PRIMARY_CITY.name}. Objektif nou senp: fè w jwenn manje kreyòl otantik cho lakay ou, san
          tèt chaje, ak peman ki fasil pou tout moun — MonCash, NatCash, oswa kach nan men.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-5 text-center shadow-sm">
            <Store className="mx-auto h-8 w-8 text-brand-deep" />
            <div className="mt-2 font-display font-bold text-ink">Restoran</div>
            <p className="mt-1 text-sm text-ink-soft">
              Nou travay ak restoran ki apwouve nan {PRIMARY_CITY.name} pou garanti kalite ak
              fyabilite.
            </p>
          </div>
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-5 text-center shadow-sm">
            <Bike className="mx-auto h-8 w-8 text-brand-deep" />
            <div className="mt-2 font-display font-bold text-ink">Livrè</div>
            <p className="mt-1 text-sm text-ink-soft">
              Yon rezo livrè lokal ki swiv pozisyon yo an tan reyèl pou yon livrezon rapid.
            </p>
          </div>
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-5 text-center shadow-sm">
            <Users className="mx-auto h-8 w-8 text-brand-deep" />
            <div className="mt-2 font-display font-bold text-ink">Kliyan</div>
            <p className="mt-1 text-sm text-ink-soft">
              Kòmande an kèk klik, swiv kòmand ou an tan reyèl, epi peye jan ou vle.
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl bg-brand-soft/30 p-5 text-center">
          <p className="text-sm text-ink-soft">
            Ou gen yon restoran oswa ou vle livre pou nou?{" "}
            <Link to="/auth/register" className="font-bold text-brand-deep hover:underline">
              Enskri kounye a
            </Link>
            .
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

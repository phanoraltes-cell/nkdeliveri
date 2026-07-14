import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/site-config";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageMeta({
      title: "Politik Konfidansyalite — NK Deliveri",
      description: "Kijan NK Deliveri jere done pèsonèl itilizatè yo.",
      path: "/privacy",
    }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="mb-3 font-display text-3xl font-extrabold text-ink">
          Politik Konfidansyalite
        </h1>
        <div className="rounded-2xl bg-white p-6 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
          <p className="text-sm text-ink-soft">
            Paj sa a ap mete ajou byento ak detay konplè sou kijan NK Deliveri kolekte, itilize, epi
            pwoteje done pèsonèl ou yo (kont, kòmand, pozisyon GPS pou livrezon, elatriye), ansanm
            ak founisè tès nou yo (Supabase pou done, OpenStreetMap pou kat).
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            Pou kèlkeswa kesyon sou done pèsonèl ou anvan sa, ekri nou nan{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-bold text-brand-deep hover:underline"
            >
              {CONTACT_EMAIL}
            </a>{" "}
            oswa vizite paj{" "}
            <Link to="/contact" className="font-bold text-brand-deep hover:underline">
              Kontak
            </Link>{" "}
            nou an.
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

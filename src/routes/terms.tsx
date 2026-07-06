import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/site-config";

export const Route = createFileRoute("/terms")({
  head: () =>
    pageMeta({
      title: "Kondisyon Itilizasyon — NK Deliveri",
      description: "Kondisyon itilizasyon platfòm NK Deliveri.",
      path: "/terms",
    }),
  component: Terms,
});

function Terms() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="mb-3 font-display text-3xl font-extrabold text-ink">Kondisyon Itilizasyon</h1>
        <div className="rounded-2xl bg-white p-6 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
          <p className="text-sm text-ink-soft">
            Paj sa a ap mete ajou byento ak kondisyon itilizasyon konplè platfòm NK Deliveri (kòmand,
            peman, livrezon, responsablite restoran/livrè/kliyan).
          </p>
          <p className="mt-3 text-sm text-ink-soft">
            Pou kèlkeswa kesyon legal anvan sa, ekri nou nan{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-brand-deep hover:underline">
              {CONTACT_EMAIL}
            </a>{" "}
            oswa vizite paj{" "}
            <Link to="/contact" className="font-bold text-brand-deep hover:underline">Kontak</Link> nou an.
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

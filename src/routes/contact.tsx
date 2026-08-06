import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/site-config";
import { Mail } from "lucide-react";

export const Route = createFileRoute("/contact")({
  head: () =>
    pageMeta({
      title: "Kontakte NK Deliveri",
      description:
        "Yon kesyon, yon pwoblèm ak yon kòmand, oswa ou vle vin patenè? Kontakte ekip NK Deliveri.",
      path: "/contact",
    }),
  component: Contact,
});

function Contact() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[640px] px-5 py-12">
        <h1 className="mb-3 font-display text-3xl font-extrabold text-ink">Kontakte nou</h1>
        <p className="mb-6 text-ink-soft">
          Yon kesyon sou yon kòmand, yon restoran ki enterese vin patenè, oswa yon lòt bagay? Ekri
          nou.
        </p>
        <div className="rounded-2xl bg-white p-6 shadow-brand-sm">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="flex items-center gap-3 rounded-xl border-2 border-brand-soft px-4 py-3 font-bold text-brand-deep hover:bg-brand-soft/30"
          >
            <Mail className="h-5 w-5" /> {CONTACT_EMAIL}
          </a>
          <p className="mt-4 text-sm text-ink-soft">
            Pou yon pwoblèm ki gen rapò ak yon kòmand an kou, gade{" "}
            <a href="/faq" className="font-bold text-brand-deep hover:underline">
              FAQ
            </a>{" "}
            nou an oswa itilize paj "Kòmand mwen" apre ou konekte.
          </p>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

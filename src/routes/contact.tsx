import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta } from "@/lib/seo";
import { CONTACT_EMAIL, WHATSAPP_LINK, WHATSAPP_NUMBER_DISPLAY } from "@/lib/site-config";
import { Mail } from "lucide-react";

// lucide-react pa gen mak WhatsApp (menm rezon ak TiktokIcon nan
// site-footer.tsx) — SVG desine dirèkteman isit la, `currentColor` pou li
// erite menm koulè tèks bouton an deja itilize a, pa yon imaj ki soti sou
// lòt sit.
function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2Zm0 1.67c2.2 0 4.27.86 5.82 2.42a8.19 8.19 0 0 1 2.41 5.82c0 4.56-3.71 8.27-8.27 8.27a8.3 8.3 0 0 1-4.22-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.23 8.23 0 0 1-1.26-4.39c0-4.56 3.71-8.26 8.31-8.26ZM7.52 8.32c-.16 0-.42.06-.64.31-.22.25-.85.83-.85 2.03 0 1.2.87 2.35.99 2.51.12.16 1.7 2.6 4.13 3.65.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.09.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28-.24-.12-1.44-.71-1.66-.79-.22-.08-.38-.12-.55.12-.16.24-.63.79-.77.95-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.11-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.81-.2-.48-.4-.41-.55-.42-.14-.01-.3-.01-.46-.01Z" />
    </svg>
  );
}

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
          <a
            href={WHATSAPP_LINK}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Kontakte nou sou WhatsApp"
            className="mt-3 flex items-center gap-3 rounded-xl border-2 border-brand-soft px-4 py-3 font-bold text-brand-deep hover:bg-brand-soft/30"
          >
            <WhatsAppIcon className="h-5 w-5 shrink-0" />
            <span className="min-w-0 truncate">WhatsApp — {WHATSAPP_NUMBER_DISPLAY}</span>
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

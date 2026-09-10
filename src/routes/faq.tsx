import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta, jsonLdScript } from "@/lib/seo";
import { PRIMARY_CITY } from "@/lib/site-config";

const FAQS = [
  {
    q: "Ki kote NK Deliveri livre?",
    a: `Kounye a, NK Deliveri sèvi ${PRIMARY_CITY.name} sèlman. N ap travay pou grandi sèvis la nan lòt vil pi devan.`,
  },
  {
    q: "Ki mòd peman ki disponib?",
    a: "Ou ka peye ak MonCash, NatCash, oswa kach dirèkteman nan men livrè a lè kòmand la rive.",
  },
  {
    q: "Kijan pou m swiv kòmand mwen?",
    a: 'Apre ou konekte, ale nan "Kòmand mwen" pou wè estati ak pozisyon livrè a an tan reyèl sou yon kat.',
  },
  {
    q: "Konbyen tan sa pran pou m resevwa manje m?",
    a: "Tan livrezon depann de restoran an ak distans lan, men pifò kòmand rive nan mwens pase 45 minit.",
  },
  {
    q: "Kijan pou m vin yon livrè oswa m enskri restoran mwen?",
    a: 'Klike sou "Enskri" epi chwazi kalite kont ou vle a (livrè oswa restoran). Yon administratè ap revize enfòmasyon w yo anvan ou aktive.',
  },
  {
    q: "Prèv peman mwen pa aksepte, kisa pou m fè?",
    a: "Verifye nimewo referans tranzaksyon an ak nimewo telefòn ki voye lajan an. Si pwoblèm lan kontinye, kontakte nou.",
  },
] as const;

export const Route = createFileRoute("/faq")({
  head: () => ({
    ...pageMeta({
      title: "Kesyon moun poze souvan — NK Deliveri",
      description:
        "Repons pou kesyon ou ka genyen sou kòmand, peman, livrezon ak vin patenè ak NK Deliveri.",
      path: "/faq",
    }),
    scripts: [
      jsonLdScript({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQS.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      }),
    ],
  }),
  component: Faq,
});

function Faq() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="mb-6 font-display text-3xl font-extrabold text-ink">
          Kesyon Moun Poze Souvan
        </h1>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="group rounded-2xl bg-white p-5 shadow-brand-xs">
              <summary className="cursor-pointer font-display font-bold text-ink marker:content-none">
                {f.q}
              </summary>
              <p className="mt-2 text-sm text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

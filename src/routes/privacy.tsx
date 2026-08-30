import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/site-config";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";

export const Route = createFileRoute("/privacy")({
  head: () =>
    pageMeta({
      title: "Politik Konfidansyalite — NK Deliveri",
      description: "Kijan NK Deliveri kolekte, itilize, epi pwoteje done pèsonèl itilizatè yo.",
      path: "/privacy",
    }),
  component: Privacy,
});

function Privacy() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="mb-1 font-display text-3xl font-extrabold text-ink">
          Politik Konfidansyalite
        </h1>
        <p className="mb-6 text-xs text-ink-soft">
          Vèsyon {CURRENT_TERMS_VERSION} — an vigè depi 18 Out 2026
        </p>

        <div className="mb-6 rounded-2xl border-2 border-brand-soft/60 bg-white p-4 text-xs leading-relaxed text-ink-soft">
          <strong className="text-ink">Avètisman legal :</strong> moun ki ekri dokiman sa a pa yon
          avoka, ni founisè sèvis NK Deliveri a pa youn tou. Politik sa a se yon baz solid ki
          reflete egzakteman ki done sistèm nan kolekte jodi a — li pa ranplase yon revizyon pa yon
          jiris ki lisansye an Ayiti. Nou rekòmande yon revizyon legal fòmèl anvan volim biznis la
          grandi anpil.
        </div>

        <div className="space-y-6 rounded-2xl bg-white p-6 shadow-brand-sm">
          <Section title="1. Ki done nou kolekte">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Kont ou :</strong> imèl, modpas (chifre), prenon, non, telefòn, adrès, foto
                pwofil (si ou ajoute youn).
              </li>
              <li>
                <strong>Kòmand :</strong> adrès livrezon, nòt livrezon (opsyonèl), nimewo telefòn
                kontak — obligatwa pou n ka livre kòmand ou.
              </li>
              <li>
                <strong>Peman :</strong> metòd peman ou chwazi a, montan, referans tranzaksyon (si
                se MonCash/NatCash), oswa yon ID tranzaksyon Stripe (si se kat kredi) — nou pa janm
                wè ni estoke nimewo kat kredi ou a, Stripe jere sa dirèkteman.
              </li>
              <li>
                <strong>Pozisyon GPS :</strong> sèlman si ou aktive pataje pozisyon pou yon kòmand
                espesifik (opsyon opsyonèl lè w ap kòmande) — pa janm kolekte otomatikman.
              </li>
              <li>
                <strong>Notifikasyon :</strong> yon idantifyan aparèy (pa yon "abònman push") si ou
                aksepte resevwa notifikasyon sou navigatè/telefòn ou.
              </li>
              <li>
                <strong>Dokiman :</strong> pou livrè/restoran — pyès idantite, pèmi, foto veyikil,
                logo/foto kouvèti restoran, selon tip kont lan.
              </li>
            </ul>
          </Section>

          <Section title="2. Poukisa nou kolekte done sa yo">
            <p>
              Sèlman pou fè platfòm nan fonksyone : kreye ak jere kont ou, trete ak livre kòmand ou,
              konfime peman, kontakte w si gen yon pwoblèm ak yon kòmand, epi (pou livrè/ restoran)
              valide kont yo anvan yo aktif sou platfòm nan. Nou pa vann done pèsonèl ou bay okenn
              twazyèm pati pou rezon piblisite.
            </p>
          </Section>

          <Section title="3. Kiyès ki ka wè done ou yo">
            <p>
              Baz done nou an itilize règ sekirite ki limite chak done a moun ki bezwen l sèlman :
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Kòmand ou (adrès, telefòn) :</strong> ou menm, restoran kòmand lan, livrè
                asiyen an, ak administratè platfòm nan.
              </li>
              <li>
                <strong>Pozisyon GPS pandan yon livrezon :</strong> sèlman ou menm, livrè asiyen an,
                ak administratè — <strong>pa restoran an</strong>.
              </li>
              <li>
                <strong>Enfòmasyon pwofil piblik (prenon, non, telefòn, adrès, foto) :</strong> jodi
                a done sa yo lizib pa nenpòt moun ki vizite sit la, menm san yo pa konekte — nou ap
                revize aksè sa a pou pi sekirize l pita.
              </li>
              <li>
                <strong>Peman ak dokiman idantite :</strong> ou menm ak administratè sèlman.
              </li>
            </ul>
          </Section>

          <Section title="4. Konbyen tan nou kenbe done ou yo">
            <p>
              <strong>
                Jodi a, nou pa gen ankò yon politik retansyon otomatik — done ou yo rete nan sistèm
                nou an pou tout tan, menm apre ou fin itilize platfòm nan, jiskaske ou mande n efase
                yo dirèkteman (Seksyon 6).
              </strong>{" "}
              Nou konsyan sa pa yon bon pratik alontèm e n ap travay sou yon politik retansyon
              fòmèl. De eksepsyon jodi a : pozisyon GPS pandan yon livrezon efase otomatikman kou
              livrezon an fini (livre, echwe, oswa anile), e istorik notifikasyon aplikasyon an
              efase otomatikman apre 90 jou.
            </p>
          </Section>

          <Section title="5. Founisè twazyèm pati">
            <p>Nou travay ak kèk founisè pou fè platfòm nan fonksyone :</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Founisè enfrastrikti cloud :</strong> pou ebèje sit entènèt la, baz done nou
                an, ak sistèm otantifikasyon (koneksyon) an.
              </li>
              <li>
                <strong>MonCash / NatCash :</strong> trete peman lè ou chwazi youn nan metòd sa yo —
                yo resevwa nimewo telefòn ak montan tranzaksyon an.
              </li>
              <li>
                <strong>Stripe :</strong> trete peman kat kredi/debi dirèkteman — nou pa janm wè
                nimewo kat ou a.
              </li>
              <li>
                <strong>Founisè kat/lokalizasyon :</strong> pou montre restoran sou yon kat ak swiv
                pozisyon pandan yon livrezon.
              </li>
            </ul>
          </Section>

          <Section title="6. Dwa ou">
            <p>
              Ou ka mande n aksè, korije, oswa efase done pèsonèl ou yo. Kontakte n nan{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-brand-deep underline">
                {CONTACT_EMAIL}
              </a>{" "}
              oswa atravè paj{" "}
              <Link to="/contact" className="font-bold text-brand-deep underline">
                Kontak
              </Link>{" "}
              ak demand ou.{" "}
              <strong>
                Jodi a, efase yon kont se yon pwosesis manyèl nou fè apre demand ou — nou poko gen
                yon bouton "efase kont mwen" otomatik nan aplikasyon an.
              </strong>{" "}
              N ap trete chak demand nan yon delè rezonab.
            </p>
          </Section>

          <Section title="7. Pozisyon GPS an detay">
            <p>
              Lè w ap fè yon kòmand, ou ka chwazi (opsyonèl, pa aktive pa defo) pataje pozisyon ou
              pandan livrezon an pou livrè a ka jwenn ou pi fasil. Si ou pa aktive opsyon sa a, nou
              pa kolekte okenn pozisyon GPS. Pozisyon an efase otomatikman depi kòmand lan fini
              (livre, anile, oswa echwe) — li pa gade apre sa.
            </p>
          </Section>

          <Section title="8. Chanjman nan dokiman sa a">
            <p>
              Nou ka mete politik sa a ajou. Lè yo chanje anpil, ou ap gen pou aksepte nouvo vèsyon
              an anvan ou kontinye itilize kont ou.
            </p>
          </Section>

          <Section title="9. Kontak">
            <p>
              Pou nenpòt kesyon sou done pèsonèl ou,{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-brand-deep underline">
                {CONTACT_EMAIL}
              </a>{" "}
              oswa paj{" "}
              <Link to="/contact" className="font-bold text-brand-deep underline">
                Kontak
              </Link>{" "}
              nou an. Gade tou{" "}
              <Link to="/terms" className="font-bold text-brand-deep underline">
                Kondisyon Itilizasyon
              </Link>{" "}
              nou yo.
            </p>
          </Section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-display text-lg font-bold text-ink">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

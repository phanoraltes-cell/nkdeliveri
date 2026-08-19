import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { pageMeta } from "@/lib/seo";
import { CONTACT_EMAIL } from "@/lib/site-config";
import { CURRENT_TERMS_VERSION } from "@/lib/legal";

export const Route = createFileRoute("/terms")({
  head: () =>
    pageMeta({
      title: "Kondisyon Itilizasyon — NK Deliveri",
      description: "Kondisyon itilizasyon platfòm NK Deliveri: kòmand, peman, livrezon, anilasyon.",
      path: "/terms",
    }),
  component: Terms,
});

function Terms() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <main className="mx-auto max-w-[720px] px-5 py-12">
        <h1 className="mb-1 font-display text-3xl font-extrabold text-ink">
          Kondisyon Itilizasyon
        </h1>
        <p className="mb-6 text-xs text-ink-soft">
          Vèsyon {CURRENT_TERMS_VERSION} — an vigè depi 18 Out 2026
        </p>

        <div className="mb-6 rounded-2xl border-2 border-brand-soft/60 bg-white p-4 text-xs leading-relaxed text-ink-soft">
          <strong className="text-ink">Avètisman legal :</strong> moun ki ekri dokiman sa a pa yon
          avoka, ni founisè sèvis NK Deliveri a pa youn tou. Kondisyon sa yo se yon baz solid ki
          reflete egzakteman jan platfòm nan fonksyone jodi a — yo pa ranplase yon revizyon pa yon
          jiris ki lisansye an Ayiti. Nou rekòmande yon revizyon legal fòmèl anvan volim biznis la
          grandi anpil.
        </div>

        <div className="space-y-6 rounded-2xl bg-white p-6 shadow-brand-sm">
          <Section title="1. Kiyès nou ye">
            <p>
              NK Deliveri se yon platfòm ki konekte kliyan ak restoran ak livrè endepandan nan
              Gonaïves, Ayiti. Nou opere sit entènèt la ak aplikasyon an; nou pa restoran e nou pa
              anplwaye livrè yo — yo se patnè endepandan.
            </p>
          </Section>

          <Section title="2. Kijan yon kòmand fonksyone">
            <p>
              Ou chwazi yon restoran, ou ajoute plat nan panye w, epi ou konfime kòmand lan ak yon
              adrès livrezon ak yon nimewo telefòn kontak — de done sa yo obligatwa pou n ka livre
              kòmand ou. Restoran an resevwa kòmand ou imedyatman e li ka aksepte l oswa rejte l (pa
              egzanp si li fèmen oswa si li manke stòk yon plat).
            </p>
          </Section>

          <Section title="3. Pri ak frè">
            <p>
              Tout pri afiche an Goud Ayisyen (HTG). Total ou peye a gen ladan pri manje a plis yon
              frè livrezon ki depann de zòn lakay ou (jodi a, 150 HTG pou zòn prensipal Gonaïves, ka
              diferan pou lòt zòn) — frè sa a parèt klèman anvan ou konfime kòmand ou, pa gen okenn
              frè kache apre.
            </p>
          </Section>

          <Section title="4. Peman">
            <p>Ou ka peye kòmand ou avèk youn nan kat mwayen sa yo:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>MonCash</li>
              <li>NatCash</li>
              <li>Kat kredi/debi (via Stripe)</li>
              <li>Kach lè livrezon an rive (Kach)</li>
            </ul>
            <p>
              Pou MonCash/NatCash/Kat kredi, lajan an pran nan moman ou konfime kòmand lan (oswa
              validè otomatikman apre yon vèrifikasyon). Pou peman Kach, ou peye livrè a dirèkteman
              lè manje a rive.
            </p>
          </Section>

          <Section title="5. Anile yon kòmand">
            <p>
              Ou ka anile yon kòmand san frè{" "}
              <strong>sèlman si restoran an poko kòmanse prepare l</strong> — sa vle di pandan
              kòmand lan poko sou estati "an atant" oswa "konfime". Depi restoran an kòmanse prepare
              manje a, kòmand lan pa ka anile ankò, ni pa ou, ni otomatikman.
            </p>
          </Section>

          <Section title="6. Livrezon echwe — 2 èdtan, san ranbousman">
            <p className="font-semibold text-ink">
              Sa a se seksyon ki pi enpòtan nan dokiman sa a — li l byen.
            </p>
            <p>Yon livrezon konsidere kòm echwe lè, pa egzanp :</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>ou pa reponn telefòn ou lè livrè a rele w oswa lè li rive lakay ou;</li>
              <li>adrès ou bay la pa jwenn oswa li enkòrèk;</li>
              <li>zòn lan pa aksesib pou livrè a rive (wout bloke, elatriye).</li>
            </ul>
            <p>
              Lè sa rive, livrè a rapòte livrezon an kòm echwe nan sistèm nan. Manje a rete kenbe
              nan biwo nou pandan <strong>de (2) èdtan</strong> apati moman rapò a. Ou ka kontakte
              nou pandan peryòd sa a pou reprann manje a oswa pou reòganize yon nouvo livrezon (sou
              menm kòmand lan, si sa posib).
            </p>
            <p>
              Apre 2 èdtan, manje a pa gen valè ankò (rezon sekirite alimantè) e li jete.{" "}
              <strong>Nou pa remèt lajan (san ranbousman)</strong> pou yon livrezon ki echwe pou yon
              rezon ki lakòz ou (nimewo telefòn ki pa reponn, adrès ki pa kòrèk, zòn ki pa aksesib).
              Si w kwè echèk livrezon an se yon erè platfòm nan oswa livrè a, ou ka louvri yon litij
              (gade Seksyon 9).
            </p>
          </Section>

          <Section title="7. Responsablite w kòm kliyan">
            <p>
              Ou responsab bay yon adrès ak yon nimewo telefòn ki egzat epi disponib pandan tout tan
              livrezon an ap fèt. Yon adrès enkòrèk oswa yon telefòn ki pa reponn ka lakòz yon
              livrezon echwe san ranbousman (Seksyon 6).
            </p>
          </Section>

          <Section title="8. Kalite manje a">
            <p>
              Chak restoran responsab pou kalite, ijyèn, ak egzatitid manje li prepare a — NK
              Deliveri pa prepare manje, nou konekte w ak restoran an sèlman. Nenpòt pwoblèm sou
              kalite yon plat, w ap ka rapòte l atravè yon litij pou nou envestige avèk restoran an.
            </p>
          </Section>

          <Section title="9. Fè yon litij">
            <p>
              Si gen yon pwoblèm ak yon kòmand (manje pa t bon, livrezon echwe ou kwè ki pa jis,
              elatriye), ouvri yon litij nan Kòmand mwen &gt; detay kòmand lan, oswa ekri nou nan{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-brand-deep underline">
                {CONTACT_EMAIL}
              </a>
              . Yon administratè ap revize kòmand lan ak istorik li anvan yon desizyon.
            </p>
          </Section>

          <Section title="10. Chanjman nan dokiman sa a">
            <p>
              Nou ka mete kondisyon sa yo ajou. Lè yo chanje anpil, ou ap gen pou aksepte nouvo
              vèsyon an anvan ou kontinye itilize kont ou.
            </p>
          </Section>

          <Section title="11. Kontak">
            <p>
              Pou nenpòt kesyon,{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-brand-deep underline">
                {CONTACT_EMAIL}
              </a>{" "}
              oswa paj{" "}
              <Link to="/contact" className="font-bold text-brand-deep underline">
                Kontak
              </Link>{" "}
              nou an. Gade tou{" "}
              <Link to="/privacy" className="font-bold text-brand-deep underline">
                Politik Konfidansyalite
              </Link>{" "}
              nou an.
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

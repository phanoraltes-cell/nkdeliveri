import { useActivePartners } from "@/hooks/useActivePartners";

/**
 * Tach 10 (ekstansyon) — demand itilizatè: seksyon "Patnè Ofisyèl" la te
 * sèlman nan footer a, kote vizibilite pi fèb (pati ki mwens wè sou yon
 * paj, mande defile jiska anba). Kopi sa a parèt sou paj akèy la, JIS APRE
 * seksyon scooter/enskripsyon an (NewsletterSection) — paj ki resevwa plis
 * trafik la — pou vre vizibilite, san retire vèsyon footer a (ki rete pou
 * konsistans sou tout LÒT paj yo: restoran, checkout, elatriye).
 *
 * Redesign (demand itilizatè, "MISYON — REDESIGN SEKSYON PATNÈ OFISYÈL") —
 * pa gen okenn chanjman lojik biznis/done isit la, sèlman prezantasyon:
 *   - Header 3-nivo (etikèt → tit ak mo an oranj → soutit gri), menm modèl
 *     ak lòt seksyon paj akèy la (wè HowItWorksSection).
 *   - Yon kontenè blan "premium" (rounded-3xl + shadow-brand-sm) ki abrite
 *     kat mini-kat patnè yo, olye de yon senp ranje logo poze sou fon krèm.
 *   - Anba 768px: yon rail defileman orizontal (menm modèl egzat ak
 *     KategoriPlaSection — snap-x, scrollbar kache, yon ti "peek" pwochen
 *     kat la pou fè konnen gen plis pou defile). Depi 768px: yon grid (3
 *     kolòn sou tablèt, 4 sou desktop).
 *   - AUKENN chan "kategori" pa afiche — `partners` table la pa gen chan
 *     sa a (wè useActivePartners.ts), e brief la eksplisitman mande pa
 *     envante done ki pa egziste. Kat la montre sèlman logo + non patnè a,
 *     ki se egzakteman sa `useActivePartners()` retounen.
 *   - Efè hover (leve 4px + plis lonbraj, ~200ms) itilize transition/hover
 *     CSS senp — deja kouvri pa règ global `prefers-reduced-motion` nan
 *     styles.css (@layer base), donk pa gen okenn varyant `motion-reduce:`
 *     siplemantè ki nesesè.
 *
 * Menm règ ak vèsyon anvan an: seksyon antye a pa afiche ditou si pa gen
 * okenn patnè aktif (jamè yon zòn vid/plasholdè).
 */
export function PartnersSection() {
  const partners = useActivePartners();
  if (!partners.data?.length) return null;

  return (
    <section aria-label="Patnè Ofisyèl" className="mx-auto max-w-[1200px] px-5 pb-16">
      <div className="mb-6 text-center">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-brand">
          Patnè Ofisyèl
        </span>
        <h2 className="font-display text-[clamp(1.5rem,2.6vw,2rem)] font-extrabold tracking-tight text-ink">
          Yo fè <span className="text-brand">konfyans</span> ak NK Deliveri
        </h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
          Antrepriz lokal ki chwazi platfòm nou an pou grandi ansanm ak kominote a.
        </p>
      </div>

      <div className="rounded-3xl border border-brand-soft/40 bg-white p-5 shadow-brand-sm sm:p-6 md:p-8">
        <div className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:mx-0 md:grid md:snap-none md:grid-cols-3 md:gap-5 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-4">
          {partners.data.map((p) => {
            const card = (
              <div className="group flex h-full w-[136px] shrink-0 snap-start flex-col items-center gap-2 rounded-2xl border border-brand-soft/30 bg-cream/60 p-4 text-center transition duration-200 hover:-translate-y-1 hover:border-brand-soft/60 hover:shadow-brand-sm md:w-full md:shrink">
                <img
                  src={p.logo_url}
                  alt={p.name}
                  width={56}
                  height={56}
                  loading="lazy"
                  className="h-14 w-14 rounded-xl border border-brand-soft/40 bg-white object-contain p-2"
                />
                <span className="line-clamp-2 text-xs font-bold text-ink sm:text-sm">{p.name}</span>
              </div>
            );
            return p.link_url ? (
              <a
                key={p.id}
                href={p.link_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={p.name}
                className="rounded-2xl"
              >
                {card}
              </a>
            ) : (
              <div key={p.id}>{card}</div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

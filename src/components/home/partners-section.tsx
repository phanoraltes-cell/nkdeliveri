import { useActivePartners } from "@/hooks/useActivePartners";

/**
 * Tach 10 (ekstansyon) — demand itilizatè: seksyon "Patnè Ofisyèl" la te
 * sèlman nan footer a, kote vizibilite pi fèb (pati ki mwens wè sou yon
 * paj, mande defile jiska anba). Kopi sa a parèt sou paj akèy la, JIS APRE
 * seksyon scooter/enskripsyon an (NewsletterSection) — paj ki resevwa plis
 * trafik la — pou vre vizibilite, san retire vèsyon footer a (ki rete pou
 * konsistans sou tout LÒT paj yo: restoran, checkout, elatriye).
 *
 * Menm règ ak vèsyon footer a: seksyon antye a pa afiche ditou si pa gen
 * okenn patnè aktif (jamè yon zòn vid/plasholdè).
 */
export function PartnersSection() {
  const partners = useActivePartners();
  if (!partners.data?.length) return null;

  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-16">
      <span className="mb-4 block text-center text-xs font-bold uppercase tracking-wide text-ink-soft">
        Patnè Ofisyèl NK Deliveri
      </span>
      <div className="flex flex-wrap items-center justify-center gap-5">
        {partners.data.map((p) => {
          const logo = (
            <img
              src={p.logo_url}
              alt={p.name}
              title={p.name}
              width={64}
              height={64}
              loading="lazy"
              className="h-16 w-16 rounded-2xl border border-brand-soft/50 bg-white object-contain p-2 shadow-brand-xs transition hover:-translate-y-0.5 hover:shadow-brand-sm"
            />
          );
          return p.link_url ? (
            <a
              key={p.id}
              href={p.link_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={p.name}
            >
              {logo}
            </a>
          ) : (
            <span key={p.id}>{logo}</span>
          );
        })}
      </div>
    </section>
  );
}

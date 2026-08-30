import { useActivePlacements } from "@/hooks/useActivePlacements";
import { AdMedia } from "@/components/ads/ad-media";
import { getAdAspectRatio } from "@/lib/ad-aspect-ratio";
import { Store } from "lucide-react";

/**
 * Phase 6 of the admin evolution plan: the single home-page ad slot,
 * between the Hero and the restaurant grid. Renders nothing when there is
 * no active campaign — never a placeholder/empty card. Always labeled
 * "Piblisite" so it's never mistaken for organic content.
 */
export function AdBannerSection() {
  const placements = useActivePlacements("home_banner", 1);
  const ad = placements.data?.[0];
  if (!ad) return null;

  const href =
    ad.link_url ?? (ad.restaurant_slug ? `/restaurants/${ad.restaurant_slug}` : undefined);
  // The restaurant's own cover photo is a last-resort fallback, used only
  // when the admin hasn't uploaded anything for the ad itself (media_url
  // and the legacy image_url both empty) — AdMedia already prefers
  // media_url over image_url on its own.
  const hasMedia = !!(ad.media_url || ad.image_url || ad.restaurant_cover_url);
  // Tach 4 — jamè koupe: itilize VRE rapò dimansyon imaj/videyo a
  // (media_width/media_height, mezire pa MediaUploader) lè li disponib.
  // Yon anons kreye anvan sa (oswa ki tonbe sou foto kouvèti restoran an,
  // ki pa gen dimansyon estoke) tonbe tounen sou ansyen kad 16:9 fiks la —
  // menm konpòtman ak jodi a, sèlman object-contain olye object-cover.
  const ratio = getAdAspectRatio(ad);

  const content = (
    <div className="relative grid overflow-hidden rounded-[32px] bg-brand-deep text-white shadow-[0_20px_60px_rgba(249,115,22,0.35)] md:grid-cols-[1.4fr_1fr]">
      <div className="relative z-10 p-8 md:p-12">
        <span className="mb-3 inline-block rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide">
          Piblisite
        </span>
        <h2 className="font-display text-[clamp(1.4rem,2.4vw,1.9rem)] font-extrabold leading-tight">
          {ad.title}
        </h2>
        {ad.description && (
          <p className="mt-2 max-w-[46ch] text-sm text-white/85">{ad.description}</p>
        )}
      </div>
      {hasMedia && (
        // Kontenè a itilize `ratio` (vre dimansyon medya a) kòm rapò
        // dimansyon lè li disponib, san bezwen `aspect-[16/9]` fiks la —
        // sou mobil, wotè kad la swiv medya a egzakteman. Sou desktop, kòn
        // nan gwoup kontinye ranpli wotè liy grid la (absolute+inset), kad
        // la sèvi sèlman kòm yon "minimòm" pou evite yon efondreman a 0
        // pandan chajman.
        <div
          className={
            ratio
              ? "relative bg-black/10 md:aspect-auto"
              : "relative aspect-[16/9] bg-black/10 md:aspect-auto"
          }
          style={ratio ? { aspectRatio: ratio } : undefined}
        >
          <AdMedia
            ad={{ ...ad, image_url: ad.image_url ?? ad.restaurant_cover_url }}
            icon={Store}
            loading="lazy"
            width={ad.media_width ?? 1024}
            height={ad.media_height ?? 768}
            className="h-full w-full object-contain object-center md:absolute md:inset-0"
          />
        </div>
      )}
    </div>
  );

  return (
    <section className="mx-auto max-w-[1200px] px-5 pb-14">
      {href ? (
        <a href={href} className="block transition hover:opacity-95">
          {content}
        </a>
      ) : (
        content
      )}
    </section>
  );
}

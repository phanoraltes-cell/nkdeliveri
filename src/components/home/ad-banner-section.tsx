import { useActivePlacements } from "@/hooks/useActivePlacements";
import { AdMedia } from "@/components/ads/ad-media";
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

  const content = (
    <div className="relative grid overflow-hidden rounded-[32px] bg-brand-deep text-white shadow-[0_20px_60px_rgba(249,115,22,0.35)] md:grid-cols-[1.4fr_1fr]">
      <div className="relative z-10 p-8 md:p-12">
        <span className="mb-3 inline-block rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wide">
          Piblisite
        </span>
        <h2 className="font-display text-[clamp(1.4rem,2.4vw,1.9rem)] font-extrabold leading-tight">
          {ad.title}
        </h2>
      </div>
      {hasMedia && (
        // Fixed 16:9 frame on mobile (this column previously had no defined
        // height at all — its rendered size just happened to fall out of
        // the <img>'s own intrinsic ratio, which silently broke the moment
        // an ad's media became a <video>, since a video with no CSS height
        // and no width/height attributes collapses to 0). Desktop keeps its
        // existing behavior: the image column fills whatever height the
        // grid row already resolves to, via absolute+inset.
        <div className="relative aspect-[16/9] md:aspect-auto">
          <AdMedia
            ad={{ ...ad, image_url: ad.image_url ?? ad.restaurant_cover_url }}
            icon={Store}
            loading="lazy"
            width={1024}
            height={768}
            className="h-full w-full object-cover object-center md:absolute md:inset-0"
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

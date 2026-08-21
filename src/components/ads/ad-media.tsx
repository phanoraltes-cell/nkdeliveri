import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ImageWithFallback } from "@/components/image-with-fallback";

/**
 * Shape every ad renderer already has available from `sponsored_placements`
 * (directly, or via `get_active_placements_secure`'s row) — kept minimal and
 * structural rather than importing the generated `Row` type, since callers
 * pass either the admin's full Placement row or the public RPC's row, which
 * have different column sets beyond these.
 */
export type AdMediaSource = {
  media_type?: string | null;
  media_url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  alt_text?: string | null;
  title: string;
};

type AdMediaProps = {
  ad: AdMediaSource;
  /** Fallback placeholder icon when there's no media at all — same contract as ImageWithFallback. */
  icon: LucideIcon;
  /** Sizing/aspect-ratio/rounding — applied uniformly whether the result is an image, a video, or the fallback placeholder. */
  className: string;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  width?: number;
  height?: number;
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * Piblisite refonte — the one place that decides how an ad's media renders,
 * used by every renderer that shows an ad's own image/video (admin preview
 * included) so a crop/fit/video-support fix only ever needs to happen here.
 * `image_url` is the pre-Étape-2 legacy column; `media_url` is preferred
 * when both are set (the create/update RPCs keep them in sync, but a row
 * written before this component existed may only have the legacy one).
 */
export function AdMedia({
  ad,
  icon,
  className,
  loading,
  fetchPriority,
  width,
  height,
}: AdMediaProps) {
  const reducedMotion = usePrefersReducedMotion();
  const url = ad.media_url || ad.image_url || null;
  const alt = ad.alt_text || ad.title;

  if (url && ad.media_type === "video") {
    // A visitor who's asked the OS for less motion gets the static poster
    // frame instead of an autoplaying video — same content, no motion. If
    // there's no poster (capture failed at upload time, or a video saved
    // before that existed), fall back to the fallback-icon treatment
    // rather than forcing an autoplaying video on a reduced-motion visitor.
    if (reducedMotion) {
      return (
        <ImageWithFallback
          src={ad.thumbnail_url}
          alt={alt}
          icon={icon}
          className={className}
          loading={loading}
          fetchPriority={fetchPriority}
          width={width}
          height={height}
        />
      );
    }
    return (
      <video
        src={url}
        poster={ad.thumbnail_url ?? undefined}
        className={className}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label={alt}
      />
    );
  }

  return (
    <ImageWithFallback
      src={url}
      alt={alt}
      icon={icon}
      className={className}
      loading={loading}
      fetchPriority={fetchPriority}
      width={width}
      height={height}
    />
  );
}

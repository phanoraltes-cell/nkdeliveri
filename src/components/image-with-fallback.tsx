import { storageImageUrl } from "@/lib/storage-image";
import type { LucideIcon } from "lucide-react";

type ImageWithFallbackProps = {
  src: string | null | undefined;
  alt: string;
  icon: LucideIcon;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  fetchPriority?: "high" | "low" | "auto";
  /** Applied to both the <img> and the fallback placeholder, so callers get
   * identical sizing/rounding regardless of which one renders. */
  className: string;
};

/** Renders `src` as an image, or a centered icon placeholder when there's no
 * URL — avoids the browser's broken-image icon that `<img src="">` guarantees. */
export function ImageWithFallback({
  src,
  alt,
  icon: Icon,
  width,
  height,
  loading,
  fetchPriority,
  className,
}: ImageWithFallbackProps) {
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-brand-soft/40 text-ink-soft ${className}`}
      >
        <Icon className="h-1/3 w-1/3" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      // Yon imaj Storage sèvi nan tay li afiche a, pa nan tay li te
      // telechaje a. Mezire: yon kouvèti restoran te 1 803 Ko pou yon kare
      // 280x160; menm imaj la nan bon tay la fè 13 Ko.
      //
      // Otomatik isit la EKSPRÈ, pa yon opsyon pa apelan: yon transfòmasyon
      // yon moun ka bliye pa yon transfòmasyon. Chak apelan deja pase
      // `width`/`height` paske `<img>` bezwen yo pou rezève plas la.
      //
      // `storageImageUrl` retounen `src` jan li ye a lè li pa yon objè
      // piblik Storage — fichye estatik, lyen ekstèn, bikèt prive.
      src={storageImageUrl(src, { width, height }) ?? src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      fetchPriority={fetchPriority}
      className={className}
    />
  );
}

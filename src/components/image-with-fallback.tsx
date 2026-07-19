import type { LucideIcon } from "lucide-react";

type ImageWithFallbackProps = {
  src: string | null | undefined;
  alt: string;
  icon: LucideIcon;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
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
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      className={className}
    />
  );
}

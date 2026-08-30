// Split out of ad-media.tsx (same reason media-value.ts is split out of
// media-uploader.tsx): that file exports only the <AdMedia/> component
// (react-refresh/only-export-components requires it), so this plain helper
// lives here instead.
import type { AdMediaSource } from "@/components/ads/ad-media";

/**
 * Tach 4 — koreksyon "imaj koupe": olye chak call site foure yon rapò
 * dimansyon FIKS (aspect-[16/9], h-[150px]...) ki koupe nenpòt imaj ki pa
 * gen egzakteman menm rapò a, kontenè a dwe itilize VRE rapò imaj/videyo a
 * lè li disponib. Retounen `undefined` (pa yon rapò envante) si dimansyon
 * yo pa estoke — call site a tonbe tounen sou pwòp rapò default li (yon
 * anons kreye anvan migrasyon 20260829180000, ki pa gen media_width/height
 * ditou).
 */
export function getAdAspectRatio(ad: AdMediaSource): string | undefined {
  if (!ad.media_width || !ad.media_height) return undefined;
  return `${ad.media_width} / ${ad.media_height}`;
}

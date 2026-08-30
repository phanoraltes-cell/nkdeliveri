// Single source of truth for upload constraints on the client. The
// authoritative enforcement is server-side (Supabase Storage bucket
// `file_size_limit`/`allowed_mime_types`, see the
// 20260713120000_secure_storage_buckets.sql migration) — this module only
// lets the UI fail fast with a clear message instead of a raw storage error.

// HEIC/HEIF included because it's the default camera format on iPhones —
// without it, a customer/driver photographing a payment proof or ID
// document straight from their camera roll had every upload silently
// rejected by the file-type check.
export const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, "application/pdf"] as const;

// Piblisite refonte — ads-media accepts a wider still-image set (gif/avif,
// for animated/next-gen banners a restaurant/menu photo never needs) plus
// video. gif/avif deliberately NOT added to IMAGE_MIME_TYPES itself: that
// constant is reused by every document-upload bucket above (ID photos,
// payment proofs, ...), where an animated GIF or a still-experimental-
// support AVIF would be a regression, not an improvement.
export const AD_IMAGE_MIME_TYPES = [...IMAGE_MIME_TYPES, "image/gif", "image/avif"] as const;
export const AD_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;

export const UPLOAD_LIMITS = {
  "menu-photos": { maxBytes: 5 * 1024 * 1024, allowedTypes: IMAGE_MIME_TYPES },
  "restaurant-assets": { maxBytes: 5 * 1024 * 1024, allowedTypes: IMAGE_MIME_TYPES },
  // Tach 8 Objektif B — bucket separe (pa restaurant-assets, ki gen yon
  // limit 5MB imaj-sèlman aplike nan motè Storage a) pou videyo yon plat
  // siyati, menm limit/tip ak ads-media-videos. Valè literal (pa
  // AD_VIDEO_MAX_BYTES) espre: sa a deklare PI WO pase AD_VIDEO_MAX_BYTES
  // nan fichye a — yon referans dirèk ta yon TDZ ReferenceError.
  "restaurant-videos": { maxBytes: 50 * 1024 * 1024, allowedTypes: AD_VIDEO_MIME_TYPES },
  avatars: { maxBytes: 3 * 1024 * 1024, allowedTypes: IMAGE_MIME_TYPES },
  "driver-documents": { maxBytes: 8 * 1024 * 1024, allowedTypes: DOCUMENT_MIME_TYPES },
  "payment-proofs": { maxBytes: 8 * 1024 * 1024, allowedTypes: DOCUMENT_MIME_TYPES },
  "payout-proofs": { maxBytes: 8 * 1024 * 1024, allowedTypes: DOCUMENT_MIME_TYPES },
  "dispute-attachments": { maxBytes: 8 * 1024 * 1024, allowedTypes: DOCUMENT_MIME_TYPES },
  "order-chat-attachments": { maxBytes: 8 * 1024 * 1024, allowedTypes: IMAGE_MIME_TYPES },
} as const satisfies Record<string, { maxBytes: number; allowedTypes: readonly string[] }>;
// No "ads-media" entry here (audit remediation, API-001, 2026-08-27): ad
// media now uploads to one of two purpose-sized buckets, ads-media-images
// (5MB) or ads-media-videos (50MB), each with its own matching
// file_size_limit enforced by the Storage engine itself — see
// 20260827140000_split_ads_media_bucket_by_size.sql. A single UPLOAD_LIMITS
// entry can't express "two different ceilings depending on file kind"
// anyway, which is exactly why validateAdMediaFile() below was always a
// separate function rather than a call to validateUploadFile() with this
// key — this table entry was dead code (0 callers ever passed "ads-media"
// to validateUploadFile) even before the bucket split made its one flat
// 50MB number actively wrong.

export const AD_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const AD_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

/** Ads-media specific: client-side fast-fail mirroring the two buckets' own file_size_limit/allowed_mime_types (the Storage engine is the real enforcement point for both). */
export function validateAdMediaFile(file: File): string | null {
  const isVideo = (AD_VIDEO_MIME_TYPES as readonly string[]).includes(file.type);
  const isImage = (AD_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
  if (!isVideo && !isImage) {
    return `Tip fichye "${file.type || "enkoni"}" pa aksepte. Itilize: jpg, png, webp, gif, avif (imaj) oswa mp4, webm, mov (videyo).`;
  }
  const limit = isVideo ? AD_VIDEO_MAX_BYTES : AD_IMAGE_MAX_BYTES;
  if (file.size > limit) {
    return `Fichye a twò gwo (${formatMB(file.size)}). Maksimòm pou ${isVideo ? "videyo" : "imaj"}: ${formatMB(limit)}.`;
  }
  return null;
}

export type UploadBucket = keyof typeof UPLOAD_LIMITS;

function formatMB(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10}MB`;
}

/** Returns a user-facing (Kreyòl) error message, or null if the file is acceptable. */
export function validateUploadFile(file: File, bucket: UploadBucket): string | null {
  const limit = UPLOAD_LIMITS[bucket];
  if (!(limit.allowedTypes as readonly string[]).includes(file.type)) {
    return `Tip fichye "${file.type || "enkoni"}" pa aksepte. Itilize: ${limit.allowedTypes
      .map((t) => t.split("/")[1])
      .join(", ")}.`;
  }
  if (file.size > limit.maxBytes) {
    return `Fichye a twò gwo (${formatMB(file.size)}). Maksimòm: ${formatMB(limit.maxBytes)}.`;
  }
  return null;
}

/** Throws with the same message validateUploadFile would return, for call sites that prefer to throw. */
export function assertValidUploadFile(file: File, bucket: UploadBucket): void {
  const err = validateUploadFile(file, bucket);
  if (err) throw new Error(err);
}

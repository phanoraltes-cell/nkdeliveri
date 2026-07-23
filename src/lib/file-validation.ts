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

export const UPLOAD_LIMITS = {
  "menu-photos": { maxBytes: 5 * 1024 * 1024, allowedTypes: IMAGE_MIME_TYPES },
  "restaurant-assets": { maxBytes: 5 * 1024 * 1024, allowedTypes: IMAGE_MIME_TYPES },
  avatars: { maxBytes: 3 * 1024 * 1024, allowedTypes: IMAGE_MIME_TYPES },
  "driver-documents": { maxBytes: 8 * 1024 * 1024, allowedTypes: DOCUMENT_MIME_TYPES },
  "payment-proofs": { maxBytes: 8 * 1024 * 1024, allowedTypes: DOCUMENT_MIME_TYPES },
  "payout-proofs": { maxBytes: 8 * 1024 * 1024, allowedTypes: DOCUMENT_MIME_TYPES },
} as const satisfies Record<string, { maxBytes: number; allowedTypes: readonly string[] }>;

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

// Piblisite refonte — real upload progress + cancel for admin media uploads.
//
// supabase-js's `storage.upload()` wraps `fetch`, which has no native
// upload-progress event (only download progress via a ReadableStream, which
// is the wrong direction for an upload). The only way to get real
// byte-level progress AND a working cancel button in a browser today is a
// raw XMLHttpRequest against Storage's own REST endpoint — the same
// endpoint supabase-js itself calls under the hood, so behavior (auth,
// bucket policies, error shape) is identical; this just adds `onprogress`
// and `abort()`.
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || (process.env.SUPABASE_URL as string);
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || (process.env.SUPABASE_PUBLISHABLE_KEY as string);

export type UploadProgressHandler = (percent: number) => void;

/**
 * Strips path separators and traversal sequences from a File's own `.name`
 * before it's used as (part of) a storage object path. Belt-and-suspenders:
 * every caller here already prefixes with a random id inside a fixed
 * `ads/` folder, and storage RLS is admin-only regardless, but `File.name`
 * is still attacker-influenced input (a crafted File/Blob, not necessarily
 * one that went through a real `<input type=file>` picker) and should
 * never be trusted to land in a path unexamined.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "") || "file";
}

/**
 * Uploads a File/Blob directly to a Supabase Storage bucket with real
 * progress reporting and cancellation, matching the `{ upsert: false }`
 * convention used everywhere else in this codebase (product-form.tsx) —
 * every caller here generates a unique path, so overwrite is never needed.
 */
export function uploadFileWithProgress(
  bucket: string,
  path: string,
  file: File | Blob,
  opts: { onProgress?: UploadProgressHandler; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    void (async () => {
      if (!SUPABASE_URL || !SUPABASE_KEY) {
        reject(new Error("Konfigirasyon Supabase pa disponib."));
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        reject(new Error("Ou dwe konekte pou telechaje yon fichye."));
        return;
      }
      if (opts.signal?.aborted) {
        reject(new DOMException("Upload anile", "AbortError"));
        return;
      }

      const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${encodeURI(path)}`;
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Authorization", `Bearer ${session.access_token}`);
      xhr.setRequestHeader("apikey", SUPABASE_KEY);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && opts.onProgress) {
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let message = `Erè pandan telechajman an (kòd ${xhr.status}).`;
        try {
          const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          message = parsed.message || parsed.error || message;
        } catch {
          // Non-JSON response body — keep the generic message.
        }
        reject(new Error(message));
      };
      xhr.onerror = () => reject(new Error("Erè rezo pandan telechajman an. Tanpri eseye ankò."));
      xhr.onabort = () => reject(new DOMException("Upload anile", "AbortError"));

      if (opts.signal) {
        opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
      }

      xhr.send(file);
    })();
  });
}

/** Best-effort delete — used both for the explicit "Retire" button and for orphan cleanup on unmount. */
export async function deleteStorageFiles(bucket: string, paths: string[]): Promise<void> {
  const clean = paths.filter((p): p is string => !!p);
  if (clean.length === 0) return;
  const { error } = await supabase.storage.from(bucket).remove(clean);
  if (error) {
    // Non-fatal by design: callers use this for cleanup paths (orphan
    // removal, "Retire" button) where a failed delete should never block
    // the user's actual action (closing a form, replacing a file).
    console.error(`[storage] failed to delete ${clean.length} file(s) from ${bucket}:`, error);
  }
}

export function getStoragePublicUrl(bucket: string, path: string): string {
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * Recovers a storage path from a public URL produced by getStoragePublicUrl
 * — needed because `thumbnail_url` (video poster) has no sibling `*_path`
 * column in `sponsored_placements`, only the URL is persisted.
 */
export function pathFromPublicUrl(bucket: string, url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length));
  } catch {
    return url.slice(idx + marker.length);
  }
}

/**
 * Recovers the BUCKET name itself from a public URL — added for the
 * ads-media bucket split (audit remediation, API-001): once uploads
 * started going to one of two purpose-sized buckets (ads-media-images/
 * ads-media-videos) instead of a single 'ads-media', code that needs to
 * delete/re-derive a path for an EXISTING row (uploaded before or after
 * the split) can no longer assume a single hardcoded bucket constant. The
 * public URL itself already encodes which bucket it came from
 * (".../object/public/<bucket>/<path>"), so this reads it back from
 * there rather than requiring a new DB column or a data migration.
 */
export function bucketFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/object/public/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const rest = url.slice(idx + marker.length);
  const bucket = rest.split("/")[0];
  return bucket || null;
}

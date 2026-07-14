import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Eye, X, Download } from "lucide-react";

/**
 * Thumbnail for a document/photo stored in a private Supabase Storage bucket
 * (signed URL, expires — never a public link). Click to open a full-size
 * in-app lightbox with a zoom-friendly view and an explicit download button.
 */
export function ProofThumb({
  path,
  bucket = "payment-proofs",
  alt = "Prèv peman",
}: {
  path: string;
  bucket?: string;
  alt?: string;
}) {
  // Restaurant logo/cover are stored as full public URLs already (public
  // bucket); driver documents and payment proofs are stored as bare paths in
  // a private bucket and need a fresh signed URL. Support both so callers
  // don't need to know which kind of storage each column uses.
  const isAlreadyUrl = /^https?:\/\//i.test(path);
  const [url, setUrl] = useState<string | null>(isAlreadyUrl ? path : null);
  const [open, setOpen] = useState(false);
  const isPdf = /\.pdf$/i.test(path);

  useEffect(() => {
    if (isAlreadyUrl) {
      setUrl(path);
      return;
    }
    let alive = true;
    supabase.storage
      .from(bucket)
      .createSignedUrl(path, 300)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      alive = false;
    };
  }, [path, bucket, isAlreadyUrl]);

  if (isPdf) {
    return (
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noopener"
        className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-brand-soft bg-cream text-xs font-bold text-brand-deep hover:bg-brand-soft/60"
      >
        <FileText className="h-6 w-6" />
        PDF
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        disabled={!url}
        className="group relative block h-24 w-24 overflow-hidden rounded-lg border border-brand-soft bg-cream disabled:cursor-wait"
        title="Klike pou agrandi"
      >
        {url ? (
          <img src={url} alt={alt} width={96} height={96} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">
            Chajman…
          </div>
        )}
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
          <Eye className="h-5 w-5 text-white" />
        </span>
      </button>

      {open && url && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(false)}
        >
          <img
            src={url}
            alt={alt}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="absolute right-4 top-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            <a
              href={url}
              download
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-ink hover:bg-white"
              aria-label="Telechaje"
              title="Telechaje"
            >
              <Download className="h-5 w-5" />
            </a>
            <button
              onClick={() => setOpen(false)}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-ink hover:bg-white"
              aria-label="Fèmen"
              title="Fèmen"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

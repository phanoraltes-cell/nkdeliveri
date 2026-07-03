import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Eye } from "lucide-react";

export function ProofThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const isPdf = /\.pdf$/i.test(path);

  useEffect(() => {
    let alive = true;
    supabase.storage
      .from("payment-proofs")
      .createSignedUrl(path, 300)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      alive = false;
    };
  }, [path]);

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
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener"
      className="group relative block h-24 w-24 overflow-hidden rounded-lg border border-brand-soft bg-cream"
      title="Klike pou agrandi"
    >
      {url ? (
        <img src={url} alt="Prèv peman" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[10px] text-ink-soft">
          Chajman…
        </div>
      )}
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
        <Eye className="h-5 w-5 text-white" />
      </span>
    </a>
  );
}
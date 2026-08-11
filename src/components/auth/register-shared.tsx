import { useEffect, useState } from "react";
import { Upload } from "lucide-react";

export function FormCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white p-6 shadow-brand-md ring-1 ring-brand-soft/40 sm:p-8">
      {children}
    </div>
  );
}

export function FileField({
  label,
  accept,
  onChange,
}: {
  label: string;
  accept: string;
  onChange: (f: File | null) => void;
}) {
  const [name, setName] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Refonte Frontend Premium, Phase 5 (P5) — immediate thumbnail preview
  // after picking a file, per the audit's own recommendation for this
  // exact component ("le plus coûteux en support"). Revokes the previous
  // object URL whenever a new file is picked or the component unmounts —
  // createObjectURL otherwise leaks the blob for the life of the page.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleChange(file: File | null) {
    setName(file?.name ?? "");
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    });
    onChange(file);
  }

  return (
    <label className="flex cursor-pointer flex-col items-start gap-1 rounded-xl border-2 border-dashed border-brand-soft bg-brand-soft/20 px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/40">
      <span className="font-semibold text-ink">{label}</span>
      <span className="flex min-w-0 items-center gap-2">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            aria-hidden="true"
            className="h-8 w-8 shrink-0 rounded-md object-cover"
          />
        ) : (
          <Upload className="h-3.5 w-3.5 shrink-0 text-brand-deep" aria-hidden="true" />
        )}
        <span className="truncate text-brand-deep">{name || "Chwazi yon fichye"}</span>
      </span>
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

import { Star } from "lucide-react";

/** Read-only star display for a submitted rating. */
export function StarRow({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`h-4 w-4 ${n <= value ? "fill-brand text-brand" : "text-brand-soft"}`}
        />
      ))}
    </div>
  );
}

/** Interactive 1-5 star picker used when submitting a review. */
export function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} zetwal sou 5`}
          className="p-0.5"
        >
          <Star className={`h-6 w-6 ${n <= value ? "fill-brand text-brand" : "text-brand-soft"}`} />
        </button>
      ))}
    </div>
  );
}

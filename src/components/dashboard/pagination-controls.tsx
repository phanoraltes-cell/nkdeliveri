import { ChevronLeft, ChevronRight } from "lucide-react";

type PaginationControlsProps = {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  className?: string;
};

/** Shared Previous/Next pager for every server-paginated list in the app. */
export function PaginationControls({
  page,
  pageSize,
  totalCount,
  onPageChange,
  className,
}: PaginationControlsProps) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  if (pageCount <= 1) return null;

  return (
    <div className={`flex items-center justify-between gap-3 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        className="inline-flex items-center gap-1 rounded-full border border-brand-soft bg-white px-3 py-2 text-xs font-bold text-brand-deep hover:bg-brand-soft/40 disabled:opacity-40"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Anvan
      </button>
      <span className="text-xs font-medium text-ink-soft">
        Paj {page} sou {pageCount} · {totalCount} total
      </span>
      <button
        type="button"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        className="inline-flex items-center gap-1 rounded-full border border-brand-soft bg-white px-3 py-2 text-xs font-bold text-brand-deep hover:bg-brand-soft/40 disabled:opacity-40"
      >
        Apre <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

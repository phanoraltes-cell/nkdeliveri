import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** Hide this column in the mobile card view (e.g. redundant with the card title). */
  hideOnMobileCard?: boolean;
};

type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string | number;
  /** Column used as the mobile card's title. Defaults to the first column. */
  mobileTitleKey?: string;
  emptyState?: ReactNode;
  /** True while the underlying query is still in flight — renders skeleton rows instead of the empty state, so a loading list is never mistaken for a genuinely empty one. */
  loading?: boolean;
};

const SKELETON_ROW_COUNT = 4;

/**
 * Renders a proper <table> at md+ and falls back to stacked cards on mobile,
 * per the "tableaux deviennent des cartes sur mobile" requirement.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  mobileTitleKey,
  emptyState,
  loading = false,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <>
        <div className="hidden overflow-hidden rounded-2xl border border-brand-soft/60 bg-card shadow-brand-xs md:block">
          <div className="space-y-3 p-4">
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 md:hidden">
          {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      </>
    );
  }

  if (rows.length === 0 && emptyState) return <>{emptyState}</>;

  const titleKey = mobileTitleKey ?? columns[0]?.key;

  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl border border-brand-soft/60 bg-card shadow-brand-xs md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-brand-soft/50 hover:bg-transparent">
              {columns.map((col) => (
                <TableHead key={col.key} className={cn("text-ink-soft", col.className)}>
                  {col.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={getRowKey(row)} className="border-brand-soft/40">
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <div
            key={getRowKey(row)}
            className="rounded-2xl border border-brand-soft/60 bg-card p-4 shadow-brand-xs"
          >
            {columns
              .filter((col) => col.key === titleKey)
              .map((col) => (
                <div key={col.key} className="font-display text-sm font-bold text-ink">
                  {col.cell(row)}
                </div>
              ))}
            <dl className="mt-2 space-y-1.5">
              {columns
                .filter((col) => col.key !== titleKey && !col.hideOnMobileCard)
                .map((col) => (
                  <div key={col.key} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-ink-soft">{col.header}</dt>
                    <dd className="text-right font-medium text-ink">{col.cell(row)}</dd>
                  </div>
                ))}
            </dl>
          </div>
        ))}
      </div>
    </>
  );
}

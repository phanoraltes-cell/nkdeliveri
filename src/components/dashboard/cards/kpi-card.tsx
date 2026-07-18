import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type KpiCardProps = {
  label: string;
  value: string | number;
  icon: LucideIcon;
  /** Positive/negative change vs. previous period, e.g. "+12%" or "-3%". */
  delta?: string;
  hint?: string;
};

export function KpiCard({ label, value, icon: Icon, delta, hint }: KpiCardProps) {
  const deltaPositive = delta?.startsWith("+");
  const deltaNegative = delta?.startsWith("-");

  return (
    <div className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-brand-xs transition hover:shadow-brand-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink-soft">{label}</div>
          <div className="mt-1 font-display text-2xl font-extrabold text-ink">{value}</div>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      {(delta || hint) && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          {delta && (
            <span
              className={cn(
                "font-bold",
                deltaPositive && "text-emerald-600",
                deltaNegative && "text-red-600",
                !deltaPositive && !deltaNegative && "text-ink-soft",
              )}
            >
              {delta}
            </span>
          )}
          {hint && <span className="text-ink-soft">{hint}</span>}
        </div>
      )}
    </div>
  );
}

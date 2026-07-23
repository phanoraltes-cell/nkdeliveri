import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "good" | "warn" | "bad" | "neutral" | "info";

const TONE_CLASSES: Record<StatusTone, string> = {
  good: "bg-emerald-100 text-emerald-800",
  warn: "bg-amber-100 text-amber-800",
  bad: "bg-red-100 text-red-800",
  neutral: "bg-ink/10 text-ink-soft",
  info: "bg-sky-100 text-sky-800",
};

/**
 * Small uppercase status pill (paid/pending/rejected, online/busy, active/
 * inactive, ...) — the same rounded-full/emerald-amber-red/neutral markup
 * used to be hand-copied at each call site. `tone` is the caller's own
 * business-status-to-color mapping (unchanged); this component only owns
 * the shared visual shell.
 */
export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

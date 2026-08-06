import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "good" | "warn" | "bad" | "neutral" | "info";

// Refonte Frontend Premium, Phase 1 (P1) — migrated off raw Tailwind
// palette colors (bg-emerald-100/text-emerald-800, ...) onto the
// --status-* tokens registered in styles.css, so every status pill in the
// app (this component) shares one source of truth instead of each
// call-site's `tone` mapping needing its own separately-maintained color
// choice if the palette ever changes. `neutral` intentionally stays on the
// existing --ink token rather than gaining a new --status-neutral — it
// already means "no particular status", which --ink/10 already expresses.
const TONE_CLASSES: Record<StatusTone, string> = {
  good: "bg-status-good-soft text-status-good",
  warn: "bg-status-warn-soft text-status-warn",
  bad: "bg-status-bad-soft text-status-bad",
  neutral: "bg-ink/10 text-ink-soft",
  info: "bg-status-info-soft text-status-info",
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

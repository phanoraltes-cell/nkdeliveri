import * as React from "react";

import { cn } from "@/lib/utils";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visually marks this chip as the active filter/selection. */
  selected?: boolean;
}

/**
 * Pill-shaped filter/selection chip — formalizes the pattern already used
 * for cuisine filters (home, restaurant listing) so new filter UIs reuse it
 * instead of re-deriving the same className string per screen.
 */
const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, selected = false, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2",
        selected
          ? "border-brand bg-brand-deep text-white shadow-brand-sm"
          : "border-brand-soft bg-white text-ink-soft hover:border-brand hover:text-brand-deep",
        className,
      )}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";

export { Chip };

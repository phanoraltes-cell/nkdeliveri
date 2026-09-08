import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2",
  {
    variants: {
      variant: {
        // Menm règ ak Button (kontras 2026-09): tèks blan mande
        // `brand-deep` (5.06:1), pa `brand` (2.80:1); tèks sou yon chip
        // `brand-soft` se `--ink` (12.36:1) — oranj sou oranj pal pa ka
        // rive AA.
        default:
          "border-transparent bg-brand-deep text-white shadow-brand-xs hover:bg-brand-deep-hover",
        secondary: "border-transparent bg-brand-soft/70 text-ink hover:bg-brand-soft",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-brand-soft text-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

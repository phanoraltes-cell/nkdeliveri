import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-[transform,box-shadow,background-color,color,border-color] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-brand text-white shadow-brand-sm hover:-translate-y-0.5 hover:bg-brand-deep hover:shadow-brand-md active:translate-y-0",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:-translate-y-0.5 hover:bg-destructive/90 hover:shadow-md active:translate-y-0",
        outline:
          "border-2 border-brand-soft bg-white text-ink shadow-sm hover:border-brand hover:bg-brand-soft/30 hover:text-brand-deep",
        secondary: "bg-brand-soft/70 text-brand-deep hover:bg-brand-soft",
        ghost: "text-ink hover:bg-brand-soft/40 hover:text-brand-deep",
        link: "rounded-none text-brand underline-offset-4 hover:text-brand-deep hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2",
        sm: "h-9 rounded-full px-4 text-xs",
        lg: "h-12 rounded-full px-7 text-[0.95rem]",
        icon: "h-11 w-11 rounded-full",
        // For the smaller circular icon-only buttons scattered across the
        // app (h-9/h-10, e.g. add-to-cart, header icons) that don't match
        // the default icon size — added so migrating them to <Button>
        // doesn't force them to visually grow to h-11.
        "icon-sm": "h-9 w-9 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * Shows a spinner and disables interaction, without swapping the label
   * for silent iconography — the label stays visible (dimmed) and
   * `aria-busy` is set, so a screen reader still announces what the
   * button does instead of losing its accessible name mid-action.
   * Refonte Frontend Premium, Phase 1 (P1) — replaces the ad hoc
   * "changer le libellé pendant le chargement" pattern used at call sites
   * across the app (e.g. checkout.tsx's `submitting ? "Ap kreye…" : ...`).
   * Only applies when `asChild` is false — `asChild` hands the DOM node
   * to whatever child was passed (often a router <Link>), which can't
   * also carry the spinner markup without breaking that child's own
   * children contract.
   */
  isLoading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, isLoading = false, children, ...props }, ref) => {
    if (asChild) {
      // `...props` still carries `disabled` through untouched here (it's
      // never destructured out in this branch) — Radix's <Slot> types its
      // props as generic HTMLAttributes, which doesn't declare `disabled`,
      // so passing it as an explicit named attribute fails to typecheck;
      // spreading it keeps the passthrough correct without fighting that.
      return (
        <Slot className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        aria-busy={isLoading || undefined}
        {...props}
        disabled={props.disabled || isLoading}
      >
        {isLoading ? (
          // Wrapping is conditional, not unconditional: the button's own
          // `gap-2` (buttonVariants above) only ever spaces *direct* flex
          // children apart. An unconditional wrapper span here would
          // collapse every existing icon+label usage (e.g. `<Icon .../>
          // Anile kòmand`) into a single flex item, silently erasing the
          // gap between them for every Button in the app — this was
          // exactly that bug, caught before any call site started
          // depending on it. Only the loading state gets its own span
          // (needed to dim the label as one unit), and that span gets its
          // own `inline-flex items-center gap-2` so it doesn't reintroduce
          // the same problem for whatever the label contains.
          <span
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
          />
        ) : null}
        {isLoading ? (
          <span className="inline-flex items-center gap-2 opacity-70">{children}</span>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

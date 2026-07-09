import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shared text-input styling for hand-built forms across the dashboard/auth pages. */
export function inputCls() {
  return "w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm outline-none focus:border-brand";
}

/** Denser variant of {@link inputCls} for forms packed into a modal/panel. */
export function inputClsCompact() {
  return "w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand";
}

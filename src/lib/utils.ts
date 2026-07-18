import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Shared text-input styling for hand-built forms across the dashboard/auth pages. */
export function inputCls() {
  return "w-full rounded-xl border-2 border-brand-soft bg-white px-4 py-2.5 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft focus:border-brand focus:shadow-brand-xs focus-visible:ring-2 focus-visible:ring-brand/30";
}

/** Denser variant of {@link inputCls} for forms packed into a modal/panel. */
export function inputClsCompact() {
  return "w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm text-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ink-soft focus:border-brand focus:shadow-brand-xs focus-visible:ring-2 focus-visible:ring-brand/30";
}

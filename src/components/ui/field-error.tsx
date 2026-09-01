/**
 * F-04 remediation (docs/FRONTEND_GLOBAL_AUDIT.md §25) — every form in this
 * project surfaced validation failures exclusively via a `sonner` toast
 * (see grep in the audit: 0 `aria-invalid` in src/routes, src/components/auth).
 * A toast is timed and not tied to the offending field, so a screen-reader
 * user who misses it (or navigates by field, not by document order) gets no
 * indication of what's wrong or where. This renders a small inline message
 * next to the field, linked to its input via `aria-describedby`.
 *
 * Usage: give the input `aria-invalid={!!error}` and
 * `aria-describedby={error ? id : undefined}`, then render
 * `<FieldError id={id} message={error} />` right after it.
 */
export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs font-semibold text-red-600">
      {message}
    </p>
  );
}

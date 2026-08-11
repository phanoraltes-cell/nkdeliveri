import type { WeeklyHours } from "@/components/hours-picker";

/**
 * Pure, exported for unit testing (no DOM/RTL in this project's Vitest
 * setup — same "extract the pure logic" pattern as createPollController).
 * Encodes as a JSON *string* to stay inside baseSignUp's
 * Record<string,string> metadata contract; omits the key entirely when
 * `hours` is empty so an untouched picker produces the exact same
 * raw_user_meta_data (and therefore the same '{}' fallback in
 * handle_new_user()) as before this fix.
 *
 * Split out of restaurant-form.tsx into its own file
 * (react-refresh/only-export-components cleanup, remediation 07) so that
 * component file only exports the component — no behavior change.
 */
export function buildRestaurantHoursMetadata(hours: WeeklyHours): Record<string, string> {
  return Object.keys(hours).length > 0 ? { restaurant_hours: JSON.stringify(hours) } : {};
}

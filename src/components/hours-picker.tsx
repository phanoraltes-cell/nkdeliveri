import type { Dispatch, SetStateAction } from "react";
import { HOURS_DAYS } from "./hours-picker.data";

/**
 * Shared day-by-day opening-hours editor — extracted from
 * dashboard.restaurant.profile.tsx (2026-08-09 remediation,
 * docs/DRIVER_RESTAURANT_REGISTRATION_REMEDIATION_REPORT.md) so the
 * restaurant signup form can collect `opening_hours` in the *exact* shape
 * `restaurants.opening_hours`/`update_restaurant_hours_secure` actually
 * expect, instead of duplicating this UI or inventing a new format. Byte-
 * identical behavior to the original inline version — only relocated.
 */
export type DayHours = { open: string; close: string; closed: boolean };
export type WeeklyHours = Record<string, DayHours>;

const DEFAULT_DAY: DayHours = { open: "10:00", close: "22:00", closed: false };

export function HoursPicker({
  value,
  onChange,
}: {
  value: WeeklyHours;
  onChange: Dispatch<SetStateAction<WeeklyHours>>;
}) {
  return (
    <div className="space-y-2">
      {HOURS_DAYS.map((d) => {
        const v = value[d.key] ?? DEFAULT_DAY;
        return (
          <div
            key={d.key}
            className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft/10 p-2"
          >
            <span className="w-24 text-sm font-bold">{d.label}</span>
            <label className="flex items-center gap-1 text-xs text-ink-soft">
              <input
                type="checkbox"
                checked={!v.closed}
                onChange={(e) =>
                  onChange((s) => ({ ...s, [d.key]: { ...v, closed: !e.target.checked } }))
                }
              />
              Ouvè
            </label>
            {!v.closed && (
              <>
                <input
                  type="time"
                  value={v.open}
                  onChange={(e) =>
                    onChange((s) => ({ ...s, [d.key]: { ...v, open: e.target.value } }))
                  }
                  aria-label={`Lè ouvèti ${d.label}`}
                  className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
                />
                <span className="text-xs text-ink-soft">jiska</span>
                <input
                  type="time"
                  value={v.close}
                  onChange={(e) =>
                    onChange((s) => ({ ...s, [d.key]: { ...v, close: e.target.value } }))
                  }
                  aria-label={`Lè fèmti ${d.label}`}
                  className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

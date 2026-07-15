import { useQuery } from "@tanstack/react-query";
import { CREOLE_DAY } from "@/lib/creole";

export type WeeklySeriesPoint = { label: string; value: number };

/** Midnight, 6 days before today — the start of the trailing 7-day window every weekly chart in this app uses. */
function startOfTrailingWeek(): Date {
  const since = new Date();
  since.setDate(since.getDate() - 6);
  since.setHours(0, 0, 0, 0);
  return since;
}

/**
 * Buckets arbitrary rows into a 7-day series (oldest to newest, Kreyòl day
 * labels), backfilling days with no matching rows to 0. Pulled out of
 * dashboard.admin/driver/restaurant.index.tsx, which each hand-rolled this
 * exact bucketing loop around a different Supabase table.
 */
function bucketWeeklySeries<T>(
  rows: readonly T[],
  since: Date,
  toDateAndValue: (row: T) => { date: string | null | undefined; value: number },
): WeeklySeriesPoint[] {
  const byDay = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(since);
    d.setDate(since.getDate() + i);
    byDay.set(d.toDateString(), 0);
  }
  for (const row of rows) {
    const { date, value } = toDateAndValue(row);
    if (!date) continue;
    const key = new Date(date).toDateString();
    if (byDay.has(key)) byDay.set(key, (byDay.get(key) ?? 0) + value);
  }
  return Array.from(byDay.entries()).map(([dateStr, value]) => ({
    label: CREOLE_DAY[new Date(dateStr).getDay()],
    value,
  }));
}

/**
 * A useQuery wrapper for "sum some numeric field into a trailing 7-day
 * series" — the shape every admin/driver/restaurant weekly chart shares.
 * `fetchRows` only fetches the raw rows for the window (table, filters and
 * columns stay caller-specific for type safety); bucketing and Kreyòl day
 * labeling happen here, once.
 */
export function useWeeklySeries<T>(
  queryKey: readonly unknown[],
  fetchRows: (since: Date) => Promise<T[]>,
  toDateAndValue: (row: T) => { date: string | null | undefined; value: number },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKey as unknown[],
    enabled: options?.enabled,
    queryFn: async () => {
      const since = startOfTrailingWeek();
      const rows = await fetchRows(since);
      return bucketWeeklySeries(rows, since, toDateAndValue);
    },
  });
}

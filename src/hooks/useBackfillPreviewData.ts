import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PreviewRow = {
  order_id: string;
  order_number: string;
  order_date: string;
  restaurant_id: string;
  restaurant_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  subtotal: number;
  delivery_fee: number;
  restaurant_commission_amount: number | null;
  driver_commission_amount: number | null;
  platform_commission_amount: number;
  migration_status: string;
  total_count: number;
};

/**
 * Read-only data for the Backfill Wizard's Scan/Preview steps — extracted
 * verbatim from dashboard.admin.payout-migration.tsx (same query keys/RPCs).
 * The wizard's step state machine and its execute mutation stay in the
 * route file: they own UI transitions (setStep/setResults on success),
 * which isn't a "data fetching" concern.
 */
export function useBackfillPreviewData(
  step: "scan" | "preview" | "confirm" | "execute" | "report",
  search: string,
  restaurantFilter: string,
  driverFilter: string,
  from: string,
  to: string,
  page: number,
  pageSize: number,
) {
  const summary = useQuery({
    queryKey: ["backfill-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_historical_backfill_summary_secure");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const previewQueryKey = [
    "backfill-preview",
    search,
    restaurantFilter,
    driverFilter,
    from,
    to,
    page,
  ] as const;
  const preview = useQuery({
    queryKey: previewQueryKey,
    enabled: step === "preview" || step === "confirm",
    queryFn: async (): Promise<PreviewRow[]> => {
      const { data, error } = await supabase.rpc("get_historical_backfill_preview_secure", {
        _search: search || undefined,
        _restaurant_id: restaurantFilter || undefined,
        _driver_id: driverFilter || undefined,
        _from: from || undefined,
        _to: to || undefined,
        _sort: "date_asc",
        _limit: pageSize,
        _offset: (page - 1) * pageSize,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        subtotal: Number(r.subtotal),
        delivery_fee: Number(r.delivery_fee),
        restaurant_commission_amount:
          r.restaurant_commission_amount != null ? Number(r.restaurant_commission_amount) : null,
        driver_commission_amount:
          r.driver_commission_amount != null ? Number(r.driver_commission_amount) : null,
        platform_commission_amount: Number(r.platform_commission_amount),
        total_count: Number(r.total_count),
      }));
    },
  });

  // Small, unfiltered/unpaginated fetch (dataset is historical + one-time,
  // expected small) purely to populate the restaurant/driver filter
  // dropdowns with the beneficiaries actually present in the qualifying set.
  const filterOptions = useQuery({
    queryKey: ["backfill-filter-options"],
    enabled: step === "preview" || step === "confirm",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_historical_backfill_preview_secure", {
        _sort: "date_asc",
        _limit: 500,
        _offset: 0,
      });
      if (error) throw error;
      const restaurants = new Map<string, string>();
      const drivers = new Map<string, string>();
      for (const r of data ?? []) {
        if (r.restaurant_name) restaurants.set(r.restaurant_id, r.restaurant_name);
        if (r.driver_id && r.driver_name) drivers.set(r.driver_id, r.driver_name);
      }
      return {
        restaurants: Array.from(restaurants, ([id, name]) => ({ id, name })),
        drivers: Array.from(drivers, ([id, name]) => ({ id, name })),
      };
    },
  });

  return { summary, preview, filterOptions };
}

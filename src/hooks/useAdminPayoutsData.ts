import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";

export type WalletRow = {
  id: string;
  name: string;
  moncash_number: string | null;
  moncash_account_name: string | null;
  natcash_number: string | null;
  natcash_account_name: string | null;
  available_balance: number;
  pending_balance: number;
  paid_balance: number;
  lifetime_earnings: number;
  total_orders: number;
  last_payment_date: string | null;
  computed_status: string;
  total_count: number;
};

const MONTH_LABEL = new Intl.DateTimeFormat("fr-HT", { month: "short" });

function bucketMonthly(rows: { month: string; value: number }[]) {
  return rows.map((r) => ({ label: MONTH_LABEL.format(new Date(r.month)), value: r.value }));
}

// get_restaurant_wallets_admin/get_driver_wallets_admin return the same
// shape under different column names (restaurant_id vs driver_id) — one
// mapper for both instead of two near-identical inline ones.
function mapWalletRow(r: {
  restaurant_id?: string;
  driver_id?: string;
  name: string;
  moncash_number: string | null;
  moncash_account_name: string | null;
  natcash_number: string | null;
  natcash_account_name: string | null;
  available_balance: number | string;
  pending_balance: number | string;
  paid_balance: number | string;
  lifetime_earnings: number | string;
  total_orders: number;
  last_payment_date: string | null;
  computed_status: string;
  total_count: number | string;
}): WalletRow {
  return {
    id: (r.restaurant_id ?? r.driver_id)!,
    name: r.name,
    moncash_number: r.moncash_number,
    moncash_account_name: r.moncash_account_name,
    natcash_number: r.natcash_number,
    natcash_account_name: r.natcash_account_name,
    available_balance: Number(r.available_balance),
    pending_balance: Number(r.pending_balance),
    paid_balance: Number(r.paid_balance),
    lifetime_earnings: Number(r.lifetime_earnings),
    total_orders: r.total_orders,
    last_payment_date: r.last_payment_date,
    computed_status: r.computed_status,
    total_count: Number(r.total_count),
  };
}

/**
 * Every data source the admin Payouts page reads — extracted verbatim from
 * dashboard.admin.payouts.tsx (same query keys/RPCs/realtime sync) so that
 * route file can stay focused on filter/dialog state and rendering.
 */
export function useAdminPayoutsData(
  tab: "restaurant" | "driver",
  search: string,
  status: string,
  sort: string,
  page: number,
  pageSize: number,
) {
  const kpisQueryKey = ["admin-payout-kpis"] as const;
  const kpis = useQuery({
    queryKey: kpisQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_payout_kpis");
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  const since = new Date();
  since.setMonth(since.getMonth() - 6);
  const fromStr = since.toISOString().slice(0, 10);
  const toStr = new Date().toISOString().slice(0, 10);

  const commissionSeries = useQuery({
    queryKey: ["admin-commission-monthly", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_commission_monthly_series", {
        _from: fromStr,
        _to: toStr,
      });
      if (error) throw error;
      return bucketMonthly(
        (data ?? []).map((d) => ({ month: d.month, value: Number(d.total_commission) })),
      );
    },
  });

  const payoutsSeries = useQuery({
    queryKey: ["admin-payouts-monthly", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_payouts_monthly_series", {
        _from: fromStr,
        _to: toStr,
      });
      if (error) throw error;
      return bucketMonthly(
        (data ?? []).map((d) => ({ month: d.month, value: Number(d.total_paid) })),
      );
    },
  });

  const topRestaurants = useQuery({
    queryKey: ["admin-top-restaurants", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_top_restaurants_by_commission", {
        _from: fromStr,
        _to: toStr,
        _limit: 5,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({ name: r.name, value: Number(r.total_commission) }));
    },
  });

  const topDrivers = useQuery({
    queryKey: ["admin-top-drivers", fromStr, toStr],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_top_drivers_by_commission", {
        _from: fromStr,
        _to: toStr,
        _limit: 5,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({ name: r.name, value: Number(r.total_commission) }));
    },
  });

  const walletsQueryKey = ["admin-wallets", tab, search, status, sort, page] as const;
  const wallets = useQuery({
    queryKey: walletsQueryKey,
    queryFn: async (): Promise<WalletRow[]> => {
      if (tab === "restaurant") {
        const { data, error } = await supabase.rpc("get_restaurant_wallets_admin", {
          _search: search || undefined,
          _status: status || undefined,
          _sort: sort,
          _limit: pageSize,
          _offset: (page - 1) * pageSize,
        });
        if (error) throw error;
        return (data ?? []).map(mapWalletRow);
      }
      const { data, error } = await supabase.rpc("get_driver_wallets_admin", {
        _search: search || undefined,
        _status: status || undefined,
        _sort: sort,
        _limit: pageSize,
        _offset: (page - 1) * pageSize,
      });
      if (error) throw error;
      return (data ?? []).map(mapWalletRow);
    },
  });

  // Feature 9 — no page refresh required: any wallet change (a new
  // commission credited, a payout sent/confirmed/disputed/resolved)
  // refreshes the queue and every KPI live.
  useRealtimeTableSync("wallets", undefined, [walletsQueryKey, kpisQueryKey]);

  return {
    kpisQueryKey,
    kpis,
    commissionSeries,
    payoutsSeries,
    topRestaurants,
    topDrivers,
    wallets,
  };
}

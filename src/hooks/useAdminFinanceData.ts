import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";

export type FinanceOverview = {
  total_commissions: number;
  commissions_pending: number;
  commissions_paid: number;
  amount_to_disburse: number;
  payouts_today: number;
  payouts_this_week: number;
  payouts_this_month: number;
  restaurants_paid_count: number;
  drivers_paid_count: number;
  moncash_volume: number;
  cash_volume: number;
  natcash_volume: number;
};

function mapOverview(r: Record<string, number | string | null>): FinanceOverview {
  return {
    total_commissions: Number(r.total_commissions),
    commissions_pending: Number(r.commissions_pending),
    commissions_paid: Number(r.commissions_paid),
    amount_to_disburse: Number(r.amount_to_disburse),
    payouts_today: Number(r.payouts_today),
    payouts_this_week: Number(r.payouts_this_week),
    payouts_this_month: Number(r.payouts_this_month),
    restaurants_paid_count: Number(r.restaurants_paid_count),
    drivers_paid_count: Number(r.drivers_paid_count),
    moncash_volume: Number(r.moncash_volume),
    cash_volume: Number(r.cash_volume),
    natcash_volume: Number(r.natcash_volume),
  };
}

/** The Vue globale tab's 12 KPI tiles. `from`/`to` empty string = no bound (all time) for the period-scoped columns; the "today/week/month" and balance columns always ignore them — see the RPC's own comment. */
export function useAdminFinanceOverview(from: string, to: string) {
  const queryKey = ["admin-finance-overview", from, to] as const;
  const overview = useQuery({
    queryKey,
    queryFn: async (): Promise<FinanceOverview | null> => {
      const { data, error } = await supabase.rpc("get_admin_finance_overview_secure", {
        _from: from || undefined,
        _to: to || undefined,
      });
      if (error) throw error;
      const row = data?.[0];
      return row ? mapOverview(row) : null;
    },
  });
  useRealtimeTableSync("wallets", undefined, [queryKey]);
  useRealtimeTableSync("payouts", undefined, [queryKey]);
  useRealtimeTableSync("payments", undefined, [queryKey]);
  return { queryKey, overview };
}

export type FinanceHistoryRow = {
  event_id: string;
  event_date: string;
  event_type: string;
  order_id: string | null;
  order_number: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  amount: number;
  status: string | null;
  method: string | null;
  reference: string | null;
  description: string | null;
  total_count: number;
};

export type FinanceHistoryFilters = {
  search: string;
  restaurantId: string;
  driverId: string;
  from: string;
  to: string;
  amountMin: string;
  amountMax: string;
  status: string;
  method: string;
  eventType: string;
  sort: string;
};

/** The "Istorik" tab's unified, filterable, paginated cross-entity feed. */
export function useAdminFinanceHistory(
  filters: FinanceHistoryFilters,
  page: number,
  pageSize: number,
) {
  const queryKey = ["admin-finance-history", filters, page, pageSize] as const;
  const history = useQuery({
    queryKey,
    queryFn: async (): Promise<FinanceHistoryRow[]> => {
      const { data, error } = await supabase.rpc("get_admin_finance_history_secure", {
        _search: filters.search || undefined,
        _restaurant_id: filters.restaurantId || undefined,
        _driver_id: filters.driverId || undefined,
        _from: filters.from || undefined,
        _to: filters.to || undefined,
        _amount_min: filters.amountMin ? Number(filters.amountMin) : undefined,
        _amount_max: filters.amountMax ? Number(filters.amountMax) : undefined,
        _status: filters.status || undefined,
        _method: filters.method || undefined,
        _event_type: filters.eventType || undefined,
        _sort: filters.sort,
        _limit: pageSize,
        _offset: (page - 1) * pageSize,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        amount: Number(r.amount),
        total_count: Number(r.total_count),
      }));
    },
  });
  useRealtimeTableSync("wallets", undefined, [queryKey]);
  useRealtimeTableSync("payouts", undefined, [queryKey]);
  useRealtimeTableSync("payments", undefined, [queryKey]);
  return { queryKey, history };
}

export type OrderFinancialTimelineRow = {
  event_id: string;
  event_time: string;
  category: string;
  beneficiary_type: string | null;
  beneficiary_name: string | null;
  amount: number | null;
  status: string | null;
  method: string | null;
  reference: string | null;
  description: string | null;
};

/** The "Istorik" row-click drill-down — fetched only while a dialog for that order is actually open (`enabled`). */
export function useOrderFinancialTimeline(orderId: string | null) {
  return useQuery({
    queryKey: ["order-financial-timeline", orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<OrderFinancialTimelineRow[]> => {
      const { data, error } = await supabase.rpc("get_order_financial_timeline_secure", {
        _order_id: orderId!,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        ...r,
        amount: r.amount != null ? Number(r.amount) : null,
      }));
    },
  });
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { useState } from "react";
import {
  ShoppingBag,
  CheckCircle2,
  XCircle,
  Wallet,
  Percent,
  HandCoins,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";

type PaymentRow = {
  id: string;
  method: string;
  status: string;
  amount: number;
  created_at: string;
  orders: { order_number: string | null } | null;
};

const PAYMENTS_PAGE_SIZE = 20;

// Owner-only: intentionally narrower than the parent layout's owner+staff
// guard — revenue figures are financial, reserved for the owner. Not
// redundant with the layout's guard, do not remove it.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant/revenue")({
  beforeLoad: ({ context }) => {
    requireRole(context.role, ["restaurant_owner", "admin", "super_admin"]);
  },
  component: RestaurantRevenue,
});

function RestaurantRevenue() {
  const { user } = Route.useRouteContext();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(monthAgo);
  const [toDate, setToDate] = useState(today);

  const { data: restaurant } = useQuery({
    queryKey: ["me-restaurant-id", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Read directly for display purposes only ("what billing mode am I on
  // right now") — never used to compute a figure, that's entirely the
  // server RPC's job below.
  const { data: payoutDetails } = useQuery({
    queryKey: ["me-restaurant-commission-type", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurant_payout_details")
        .select("commission_type")
        .eq("restaurant_id", restaurant!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const isMonthly = payoutDetails?.commission_type === "monthly";

  const summary = useQuery({
    queryKey: ["restaurant-revenue", restaurant?.id, fromDate, toDate],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_restaurant_revenue_summary", {
        _restaurant_id: restaurant!.id,
        _from: fromDate,
        _to: toDate,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  });

  const [paymentsPage, setPaymentsPage] = useState(1);

  const payments = useQuery({
    queryKey: ["restaurant-payments", restaurant?.id, fromDate, toDate, paymentsPage],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const offset = (paymentsPage - 1) * PAYMENTS_PAGE_SIZE;
      const { data, error, count } = await supabase
        .from("payments")
        .select(
          "id, method, status, amount, created_at, orders!inner(order_number, restaurant_id, created_at)",
          { count: "exact" },
        )
        .eq("orders.restaurant_id", restaurant!.id)
        .gte("orders.created_at", fromDate)
        .lte("orders.created_at", toDate + "T23:59:59")
        .order("created_at", { ascending: false })
        .range(offset, offset + PAYMENTS_PAGE_SIZE - 1);
      if (error) throw error;
      return { rows: (data ?? []) as PaymentRow[], total: count ?? 0 };
    },
  });

  const paymentColumns: DataTableColumn<PaymentRow>[] = [
    {
      key: "created_at",
      header: "Dat",
      cell: (p) => new Date(p.created_at).toLocaleDateString("fr-HT"),
    },
    { key: "order_number", header: "Kòmand", cell: (p) => p.orders?.order_number ?? "—" },
    { key: "method", header: "Metòd", cell: (p) => p.method.toUpperCase(), hideOnMobileCard: true },
    {
      key: "amount",
      header: "Montan",
      cell: (p) => <span className="font-bold text-brand-deep">{formatHTG(Number(p.amount))}</span>,
    },
    {
      key: "status",
      header: "Estati",
      cell: (p) => (
        <StatusBadge tone={p.status === "paid" ? "good" : p.status === "failed" ? "bad" : "warn"}>
          {p.status}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Revni ak Peman</h1>
          <p className="mt-1 text-ink-soft">
            Tout chif yo kalkile sèvè-side, dirèkteman nan Rejis Komisyon an — menm chif ak "Mes
            Komisyon".
          </p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Depi
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPaymentsPage(1);
            }}
            className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Jiska
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              setPaymentsPage(1);
            }}
            className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
          />
        </label>
      </div>

      {summary.isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {summary.isError && (
        <EmptyState
          icon={AlertTriangle}
          title="Pa ka chaje rezime revni an"
          description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
          action={
            <Button variant="outline" onClick={() => summary.refetch()}>
              Eseye ankò
            </Button>
          }
        />
      )}

      {summary.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label="Kòmand total"
            value={String(summary.data.total_orders)}
            icon={ShoppingBag}
          />
          <KpiCard
            label="Livre"
            value={String(summary.data.delivered_orders)}
            icon={CheckCircle2}
          />
          <KpiCard label="Anile" value={String(summary.data.cancelled_orders)} icon={XCircle} />
          <KpiCard
            label="Revni brit (livre)"
            value={formatHTG(Number(summary.data.gross_revenue))}
            icon={Wallet}
          />
          <KpiCard
            label={
              isMonthly
                ? "Komisyon (fakti chak mwa)"
                : `Komisyon platfòm (${summary.data.commission_rate}%)`
            }
            value={formatHTG(Number(summary.data.commission_amount))}
            icon={Percent}
          />
          <KpiCard
            label="Ou dwe resevwa (net)"
            value={formatHTG(Number(summary.data.net_payout))}
            icon={HandCoins}
          />
          <KpiCard
            label="Peman konfime"
            value={formatHTG(Number(summary.data.paid_amount))}
            icon={CheckCircle2}
          />
          <KpiCard
            label="Peman an atant"
            value={formatHTG(Number(summary.data.pending_amount))}
            icon={Clock}
          />
        </div>
      )}

      <CommissionHistoryTable beneficiaryType="restaurant" beneficiaryId={restaurant?.id} />

      <section className="space-y-3">
        <div>
          <h2 className="font-display text-lg font-bold text-ink">Istwa peman kliyan</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Peman kliyan yo resevwa pou peryòd sa a (san rapò ak komisyon).
          </p>
        </div>

        {payments.isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="Pa ka chaje istwa peman kliyan"
            description="Gen yon pwoblèm rezo oswa sèvè. Tanpri eseye ankò."
            action={
              <Button variant="outline" onClick={() => payments.refetch()}>
                Eseye ankò
              </Button>
            }
          />
        ) : (
          <>
            <DataTable<PaymentRow>
              rows={payments.data?.rows ?? []}
              getRowKey={(p) => p.id}
              loading={payments.isLoading}
              mobileTitleKey="order_number"
              emptyState={
                <EmptyState
                  icon={Wallet}
                  title="Pa gen peman kliyan"
                  description="Okenn peman kliyan pou peryòd sa a."
                />
              }
              columns={paymentColumns}
            />
            <PaginationControls
              page={paymentsPage}
              pageSize={PAYMENTS_PAGE_SIZE}
              totalCount={payments.data?.total ?? 0}
              onPageChange={setPaymentsPage}
            />
          </>
        )}
      </section>
    </div>
  );
}

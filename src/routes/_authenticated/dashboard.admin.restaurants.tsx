import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { toast } from "sonner";
import { useState } from "react";
import { Percent, Store } from "lucide-react";
import { PaginationControls } from "@/components/dashboard/pagination-controls";
import { StatusBadge } from "@/components/dashboard/status-badge";

const PAGE_SIZE = 50;

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/restaurants")({
  component: AdminRestaurants,
});

const STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  approved: "Apwouve",
  rejected: "Refize",
  suspended: "Sispann",
};

function AdminRestaurants() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const restaurants = useQuery({
    queryKey: ["admin-restaurants", page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_restaurants_admin", {
        _limit: PAGE_SIZE,
        _offset: (page - 1) * PAGE_SIZE,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const totalRestaurants = restaurants.data?.[0]?.total_count ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Restoran & Komisyon</h1>
          <p className="mt-1 text-ink-soft">
            Chwazi konbyen chak restoran peye kòm komisyon platfòm.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      {restaurants.isLoading && <div className="text-ink-soft">Chajman…</div>}
      {restaurants.data?.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen okenn restoran.
        </div>
      )}

      <div className="space-y-3">
        {restaurants.data?.map((r) =>
          editingId === r.id ? (
            <CommissionForm
              key={r.id}
              restaurant={r}
              onClose={() => setEditingId(null)}
              onSaved={() => qc.invalidateQueries({ queryKey: ["admin-restaurants"] })}
            />
          ) : (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-soft/60 text-brand-deep">
                  <Store className="h-5 w-5" />
                </div>
                <div>
                  <div className="font-display text-base font-bold text-ink">{r.name}</div>
                  <div className="text-xs text-ink-soft">
                    {r.cuisine || "—"} ·{" "}
                    <StatusBadge tone={r.status === "approved" ? "good" : "warn"}>
                      {STATUS_LABEL[r.status] || r.status}
                    </StatusBadge>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-sm">
                  {r.commission_type === "monthly" ? (
                    <div className="font-bold text-brand-deep">
                      {formatHTG(Number(r.monthly_commission_amount))}/mwa
                    </div>
                  ) : (
                    <div className="font-bold text-brand-deep">
                      {Number(r.commission_rate)}% pa kòmand
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setEditingId(r.id)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-soft/60 px-3 py-2 text-xs font-bold text-brand-deep hover:bg-brand hover:text-white"
                >
                  <Percent className="h-3.5 w-3.5" /> Modifye
                </button>
              </div>
            </div>
          ),
        )}
      </div>
      <PaginationControls
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={totalRestaurants}
        onPageChange={setPage}
      />
    </div>
  );
}

type AdminRestaurantRow = {
  id: string;
  name: string;
  status: string;
  cuisine: string | null;
  commission_type: string;
  commission_rate: number;
  monthly_commission_amount: number;
};

function CommissionForm({
  restaurant,
  onClose,
  onSaved,
}: {
  restaurant: AdminRestaurantRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<"per_order" | "monthly">(
    restaurant.commission_type === "monthly" ? "monthly" : "per_order",
  );
  const [rate, setRate] = useState(String(restaurant.commission_rate ?? 10));
  const [monthly, setMonthly] = useState(String(restaurant.monthly_commission_amount ?? 0));

  const save = useMutation({
    mutationFn: async () => {
      const rateNum = Number(rate);
      const monthlyNum = Number(monthly);
      if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 100) {
        throw new Error("Pousantaj komisyon dwe ant 0 ak 100");
      }
      if (!Number.isFinite(monthlyNum) || monthlyNum < 0) {
        throw new Error("Montan chak mwa envalid");
      }
      const { error } = await supabase.rpc("update_restaurant_commission_secure", {
        _restaurant_id: restaurant.id,
        _commission_type: type,
        _commission_rate: rateNum,
        _monthly_commission_amount: monthlyNum,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Komisyon mizajou");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4">
      <div className="font-display text-base font-bold text-ink">{restaurant.name}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setType("per_order")}
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${type === "per_order" ? "bg-brand text-white" : "bg-white text-ink-soft border border-brand-soft"}`}
        >
          Pousantaj pa kòmand
        </button>
        <button
          type="button"
          onClick={() => setType("monthly")}
          className={`rounded-full px-3 py-1.5 text-xs font-bold ${type === "monthly" ? "bg-brand text-white" : "bg-white text-ink-soft border border-brand-soft"}`}
        >
          Montan fiks chak mwa
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {type === "per_order" ? (
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
              Pousantaj (%)
            </span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
        ) : (
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
              Montan chak mwa (HTG)
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={monthly}
              onChange={(e) => setMonthly(e.target.value)}
              className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand"
            />
          </label>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="rounded-full bg-brand px-5 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
        >
          {save.isPending ? "Ap sove…" : "Sove komisyon"}
        </button>
        <button
          onClick={onClose}
          className="rounded-full border-2 border-brand-soft px-5 py-2 text-sm font-bold text-ink-soft hover:bg-brand-soft/30"
        >
          Anile
        </button>
      </div>
    </div>
  );
}

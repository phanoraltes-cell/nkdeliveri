import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Percent, Store, Bike } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard/admin/commissions")({
  component: AdminCommissions,
});

type Beneficiary = { id: string; name: string; available_balance: number };

/**
 * Transversal commission browser — a beneficiary picker (restaurant or
 * driver) feeding the exact same CommissionHistoryTable already used on
 * their own "Mes Komisyon" pages and inside BeneficiaryDetailDialog. No new
 * RPC: the picker itself reuses the wallet-admin RPCs (already paginated,
 * searchable) that "Dekesman" depends on — this page only adds a new entry
 * point, never a second way to fetch the same commission rows.
 */
function AdminCommissions() {
  const [tab, setTab] = useState<"restaurant" | "driver">("restaurant");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Beneficiary | null>(null);

  function switchTab(next: "restaurant" | "driver") {
    setTab(next);
    setSearch("");
    setSelected(null);
  }

  const beneficiaries = useQuery({
    queryKey: ["admin-commissions-picker", tab, search],
    queryFn: async (): Promise<Beneficiary[]> => {
      if (tab === "restaurant") {
        const { data, error } = await supabase.rpc("get_restaurant_wallets_admin", {
          _search: search || undefined,
          _sort: "name_asc",
          _limit: 20,
        });
        if (error) throw error;
        return (data ?? []).map((r) => ({
          id: r.restaurant_id,
          name: r.name,
          available_balance: Number(r.available_balance),
        }));
      }
      const { data, error } = await supabase.rpc("get_driver_wallets_admin", {
        _search: search || undefined,
        _sort: "name_asc",
        _limit: 20,
      });
      if (error) throw error;
      return (data ?? []).map((d) => ({
        id: d.driver_id,
        name: d.name,
        available_balance: Number(d.available_balance),
      }));
    },
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Komisyon</h1>
          <p className="mt-1 text-ink-soft">
            Chwazi yon restoran oswa yon livrè pou wè istwa konplè komisyon yo.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        <button
          onClick={() => switchTab("restaurant")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-bold",
            tab === "restaurant"
              ? "border-b-2 border-brand-deep text-brand-deep"
              : "text-ink-soft hover:text-ink",
          )}
        >
          <Store className="h-3.5 w-3.5" /> Restoran
        </button>
        <button
          onClick={() => switchTab("driver")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-sm font-bold",
            tab === "driver"
              ? "border-b-2 border-brand-deep text-brand-deep"
              : "text-ink-soft hover:text-ink",
          )}
        >
          <Bike className="h-3.5 w-3.5" /> Livrè
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-brand-xs">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "restaurant" ? "Chèche yon restoran…" : "Chèche yon livrè…"}
            aria-label="Chèche yon benefisyè"
            className="mb-3 w-full rounded-lg border-2 border-brand-soft bg-white px-3 py-2.5 text-xs outline-none focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
          />
          {beneficiaries.isLoading && <div className="text-xs text-ink-soft">Chajman…</div>}
          {!beneficiaries.isLoading && beneficiaries.data?.length === 0 && (
            <div className="text-xs text-ink-soft">Pa gen rezilta.</div>
          )}
          <ul className="max-h-[520px] space-y-1 overflow-y-auto">
            {beneficiaries.data?.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => setSelected(b)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition",
                    selected?.id === b.id
                      ? "bg-brand text-white"
                      : "text-ink hover:bg-brand-soft/40",
                  )}
                >
                  <span className="min-w-0 truncate font-semibold">{b.name}</span>
                  {b.available_balance > 0 && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                        selected?.id === b.id
                          ? "bg-white/20 text-white"
                          : "bg-brand-soft/60 text-brand-deep",
                      )}
                    >
                      {formatHTG(b.available_balance)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section>
          {selected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 font-display text-lg font-bold text-ink">
                <Percent className="h-5 w-5 text-brand-deep" /> {selected.name}
              </div>
              <CommissionHistoryTable beneficiaryType={tab} beneficiaryId={selected.id} />
            </div>
          ) : (
            <EmptyState
              icon={Percent}
              title="Chwazi yon benefisyè"
              description="Chwazi yon restoran oswa yon livrè nan lis la pou wè istwa komisyon yo."
            />
          )}
        </section>
      </div>
    </div>
  );
}

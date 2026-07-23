import { createFileRoute, Link } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatHTG } from "@/lib/format";
import { inputClsCompact } from "@/lib/utils";
import { WalletSummaryCards } from "@/components/dashboard/wallet/wallet-summary-cards";
import { WalletPayoutHistorySection } from "@/components/dashboard/wallet/wallet-payout-history-section";

// Owner-only: intentionally narrower than the parent layout's owner+staff
// guard — payouts are financial, not operational, so restaurant_staff is
// excluded. Not redundant with the layout's guard, do not remove it.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant/payouts")({
  beforeLoad: ({ context }) => {
    requireRole(context.role, ["restaurant_owner", "admin", "super_admin"]);
  },
  component: MerchantPayouts,
});

function MerchantPayouts() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: r, isLoading } = useQuery({
    queryKey: ["me-restaurant-payouts", user?.id],
    queryFn: async () => {
      const { data: rest, error: e1 } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (e1) throw e1;
      if (!rest?.id) return null;
      const { data: pd, error: e2 } = await supabase
        .from("restaurant_payout_details")
        .select(
          "restaurant_id, moncash_number, moncash_account_name, natcash_number, natcash_account_name, commission_type, commission_rate, monthly_commission_amount",
        )
        .eq("restaurant_id", rest.id)
        .maybeSingle();
      if (e2) throw e2;
      return {
        id: rest.id,
        name: rest.name,
        moncash_number: pd?.moncash_number ?? null,
        moncash_account_name: pd?.moncash_account_name ?? null,
        natcash_number: pd?.natcash_number ?? null,
        natcash_account_name: pd?.natcash_account_name ?? null,
        commission_type: pd?.commission_type ?? "per_order",
        commission_rate: pd?.commission_rate ?? 10,
        monthly_commission_amount: pd?.monthly_commission_amount ?? 0,
      };
    },
  });

  const walletQueryKey = ["me-restaurant-wallet", r?.id] as const;
  const wallet = useQuery({
    queryKey: walletQueryKey,
    enabled: !!r?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("available_balance, pending_balance, paid_balance, lifetime_earnings")
        .eq("restaurant_id", r!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [f, setF] = useState({
    moncash_number: "",
    moncash_account_name: "",
    natcash_number: "",
    natcash_account_name: "",
  });

  useEffect(() => {
    if (!r) return;
    setF({
      moncash_number: r.moncash_number ?? "",
      moncash_account_name: r.moncash_account_name ?? "",
      natcash_number: r.natcash_number ?? "",
      natcash_account_name: r.natcash_account_name ?? "",
    });
    // `r` is intentionally omitted: this seeds the editable form once when
    // the record first loads (keyed on id), not on every background
    // refetch — including it would wipe in-progress edits whenever
    // react-query silently revalidates this query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!r?.id) throw new Error("Restoran pa jwenn");
      // Postgres text params happily accept NULL despite the generated
      // types marking them non-nullable (codegen can't infer per-arg
      // nullability from a plpgsql signature) — cast to keep passing null
      // for "not configured" exactly as before, not an empty string, since
      // downstream code (e.g. checkout's payNumber ?? "(pa konfigire)") checks
      // specifically for null/undefined.
      const { error } = await supabase.rpc("update_restaurant_payout_secure", {
        _restaurant_id: r.id,
        _moncash_number: (f.moncash_number || null) as string,
        _moncash_account_name: (f.moncash_account_name || null) as string,
        _natcash_number: (f.natcash_number || null) as string,
        _natcash_account_name: (f.natcash_account_name || null) as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Konfigirasyon anrejistre");
      qc.invalidateQueries({ queryKey: ["me-restaurant-payouts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-ink-soft">Chajman…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Peman ak Komisyon</h1>
          <p className="mt-1 text-ink-soft">
            Kliyan yo toujou peye NK Deliveri; ou resevwa lajan w apre komisyon sou nimewo ki anba
            a.
          </p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <WalletSummaryCards wallet={wallet.data ?? null} />

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Nimewo peman ou</h2>
        <p className="mt-1 text-xs text-ink-soft">
          Tout peman kliyan yo ale sou kont NK Deliveri. Admin peye w komisyon w sou nimewo
          MonCash/NatCash ou antre anba a — menm jan ak livrè yo.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field
            label="Nimewo MonCash"
            value={f.moncash_number}
            onChange={(v) => setF((s) => ({ ...s, moncash_number: v }))}
            placeholder="+509 …"
          />
          <Field
            label="Non kont MonCash"
            value={f.moncash_account_name}
            onChange={(v) => setF((s) => ({ ...s, moncash_account_name: v }))}
          />
          <Field
            label="Nimewo NatCash"
            value={f.natcash_number}
            onChange={(v) => setF((s) => ({ ...s, natcash_number: v }))}
            placeholder="+509 …"
          />
          <Field
            label="Non kont NatCash"
            value={f.natcash_account_name}
            onChange={(v) => setF((s) => ({ ...s, natcash_account_name: v }))}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Komisyon platfòm</h2>
        <div className="mt-3 rounded-xl bg-brand-soft/40 p-3 text-sm text-ink-soft">
          {r?.commission_type === "monthly" ? (
            <>
              Komisyon chak mwa: <b>{formatHTG(Number(r?.monthly_commission_amount ?? 0))}</b>
            </>
          ) : (
            <>
              Komisyon pa kòmand: <b>{Number(r?.commission_rate ?? 10)}%</b>
            </>
          )}
          <div className="mt-1 text-xs">
            Sèl yon administratè NK ka chanje komisyon platfòm nan.
          </div>
        </div>
      </section>

      <Button
        className="font-display font-extrabold"
        onClick={() => save.mutate()}
        disabled={save.isPending}
      >
        {save.isPending ? "Ap sove…" : "Sove chanjman yo"}
      </Button>

      <WalletPayoutHistorySection
        beneficiaryType="restaurant"
        beneficiaryId={r?.id}
        beneficiaryName={r?.name ?? ""}
        walletQueryKey={walletQueryKey}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClsCompact()}
      />
    </label>
  );
}

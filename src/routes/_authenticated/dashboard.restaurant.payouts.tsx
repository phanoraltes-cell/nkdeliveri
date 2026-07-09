import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatHTG } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/payouts")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "restaurant_owner" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
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
        .select("id")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (e1) throw e1;
      if (!rest?.id) return null;
      const { data: pd, error: e2 } = await supabase
        .from("restaurant_payout_details")
        .select("restaurant_id, moncash_number, moncash_account_name, natcash_number, natcash_account_name, payout_mode, commission_type, commission_rate, monthly_commission_amount")
        .eq("restaurant_id", rest.id)
        .maybeSingle();
      if (e2) throw e2;
      return {
        id: rest.id,
        moncash_number: pd?.moncash_number ?? null,
        moncash_account_name: pd?.moncash_account_name ?? null,
        natcash_number: pd?.natcash_number ?? null,
        natcash_account_name: pd?.natcash_account_name ?? null,
        payout_mode: pd?.payout_mode ?? "via_admin",
        commission_type: pd?.commission_type ?? "per_order",
        commission_rate: pd?.commission_rate ?? 10,
        monthly_commission_amount: pd?.monthly_commission_amount ?? 0,
      };
    },
  });

  const [f, setF] = useState({
    moncash_number: "",
    moncash_account_name: "",
    natcash_number: "",
    natcash_account_name: "",
    payout_mode: "via_admin",
  });

  useEffect(() => {
    if (!r) return;
    setF({
      moncash_number: r.moncash_number ?? "",
      moncash_account_name: r.moncash_account_name ?? "",
      natcash_number: r.natcash_number ?? "",
      natcash_account_name: r.natcash_account_name ?? "",
      payout_mode: r.payout_mode ?? "via_admin",
    });
  }, [r?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!r?.id) throw new Error("Restoran pa jwenn");
      if (f.payout_mode === "direct" && !f.moncash_number && !f.natcash_number) {
        throw new Error("Antre omwen yon nimewo MonCash oswa NatCash.");
      }
      // Postgres text params happily accept NULL despite the generated
      // types marking them non-nullable (codegen can't infer per-arg
      // nullability from a plpgsql signature) — cast to keep passing null
      // for "not configured" exactly as before, not an empty string, since
      // downstream code (e.g. checkout's payNumber ?? "(pa konfigire)") checks
      // specifically for null/undefined.
      const { error } = await supabase.rpc("update_restaurant_payout_secure", {
        _restaurant_id: r.id,
        _payout_mode: f.payout_mode,
        _moncash_number: (f.moncash_number || null) as string,
        _moncash_account_name: (f.moncash_account_name || null) as string,
        _natcash_number: (f.natcash_number || null) as string,
        _natcash_account_name: (f.natcash_account_name || null) as string,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Konfigirasyon anrejistre"); qc.invalidateQueries({ queryKey: ["me-restaurant-payouts"] }); },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-ink-soft">Chajman…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Peman ak Komisyon</h1>
          <p className="mt-1 text-ink-soft">Konfigire kote lajan kliyan yo ale ak komisyon platfòm nan.</p>
        </div>
        <Link to="/dashboard/restaurant" className="text-sm font-bold text-brand-deep hover:underline">← Dashboard</Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Kote peman MonCash/NatCash ale</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { id: "via_admin", label: "Pase pa admin", desc: "Kliyan peye NK, admin remèt ou apre komisyon retire." },
            { id: "direct", label: "Dirèkteman sou kont mwen", desc: "Kliyan peye ou dirèkteman; ou peye komisyon platfòm nan." },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setF((s) => ({ ...s, payout_mode: o.id }))}
              className={`rounded-2xl border-2 p-3 text-left ${
                f.payout_mode === o.id ? "border-brand bg-brand-soft" : "border-brand-soft bg-white"
              }`}
            >
              <div className="font-bold">{o.label}</div>
              <div className="text-xs text-ink-soft">{o.desc}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Nimewo MonCash" value={f.moncash_number} onChange={(v) => setF((s) => ({ ...s, moncash_number: v }))} placeholder="+509 …" />
          <Field label="Non kont MonCash" value={f.moncash_account_name} onChange={(v) => setF((s) => ({ ...s, moncash_account_name: v }))} />
          <Field label="Nimewo NatCash" value={f.natcash_number} onChange={(v) => setF((s) => ({ ...s, natcash_number: v }))} placeholder="+509 …" />
          <Field label="Non kont NatCash" value={f.natcash_account_name} onChange={(v) => setF((s) => ({ ...s, natcash_account_name: v }))} />
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Komisyon platfòm</h2>
        <div className="mt-3 rounded-xl bg-brand-soft/40 p-3 text-sm text-ink-soft">
          {r?.commission_type === "monthly" ? (
            <>Komisyon chak mwa: <b>{formatHTG(Number(r?.monthly_commission_amount ?? 0))}</b></>
          ) : (
            <>Komisyon pa kòmand: <b>{Number(r?.commission_rate ?? 10)}%</b></>
          )}
          <div className="mt-1 text-xs">Sèl yon administratè NK ka chanje komisyon platfòm nan.</div>
        </div>
      </section>

      <button
        onClick={() => save.mutate()}
        disabled={save.isPending}
        className="rounded-full bg-brand px-6 py-2.5 font-display font-extrabold text-white hover:bg-brand-deep disabled:opacity-60"
      >
        {save.isPending ? "Ap sove…" : "Sove chanjman yo"}
      </button>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder,
}: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}
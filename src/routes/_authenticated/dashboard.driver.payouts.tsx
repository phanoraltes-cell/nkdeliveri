import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { formatHTG } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard/driver/payouts")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "driver" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: DriverPayouts,
});

function DriverPayouts() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: d, isLoading } = useQuery({
    queryKey: ["me-driver-payouts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drivers")
        .select(
          "id, moncash_number, moncash_account_name, natcash_number, natcash_account_name, payout_frequency, commission_rate",
        )
        .eq("user_id", user!.id)
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
    payout_frequency: "daily",
  });

  useEffect(() => {
    if (!d) return;
    setF({
      moncash_number: d.moncash_number ?? "",
      moncash_account_name: d.moncash_account_name ?? "",
      natcash_number: d.natcash_number ?? "",
      natcash_account_name: d.natcash_account_name ?? "",
      payout_frequency: d.payout_frequency ?? "daily",
    });
    // `d` is intentionally omitted: this seeds the editable form once when the
    // record first loads (keyed on id), not on every background refetch —
    // including `d` here would wipe in-progress edits whenever react-query
    // silently revalidates this query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!d?.id) throw new Error("Pwofil livrè pa jwenn");
      // The generator types these args as non-nullable `string` because the
      // SQL params lack a `DEFAULT NULL` marker it recognizes — Postgres
      // accepts NULL for a plain `text` param regardless, so this cast just
      // corrects an overly-strict generated type, no behavior change.
      const { error } = await supabase.rpc("update_driver_payout_secure", {
        _driver_id: d.id,
        _moncash_number: (f.moncash_number || null) as string,
        _moncash_account_name: (f.moncash_account_name || null) as string,
        _natcash_number: (f.natcash_number || null) as string,
        _natcash_account_name: (f.natcash_account_name || null) as string,
        _payout_frequency: f.payout_frequency,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Konfigirasyon anrejistre");
      qc.invalidateQueries({ queryKey: ["me-driver-payouts"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-ink-soft">Chajman…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Peman ak Komisyon</h1>
          <p className="mt-1 text-ink-soft">Chwazi kilè admin peye w komisyon w yo.</p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Nimewo peman</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FieldD
            label="Nimewo MonCash"
            value={f.moncash_number}
            onChange={(v) => setF((s) => ({ ...s, moncash_number: v }))}
            placeholder="+509 …"
          />
          <FieldD
            label="Non kont MonCash"
            value={f.moncash_account_name}
            onChange={(v) => setF((s) => ({ ...s, moncash_account_name: v }))}
          />
          <FieldD
            label="Nimewo NatCash"
            value={f.natcash_number}
            onChange={(v) => setF((s) => ({ ...s, natcash_number: v }))}
            placeholder="+509 …"
          />
          <FieldD
            label="Non kont NatCash"
            value={f.natcash_account_name}
            onChange={(v) => setF((s) => ({ ...s, natcash_account_name: v }))}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Frekans peman komisyon</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            { id: "daily", label: "Chak jou", desc: "Resevwa komisyon jounalyè." },
            { id: "monthly", label: "Chak mwa", desc: "Resevwa yon sèl peman chak mwa." },
          ].map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setF((s) => ({ ...s, payout_frequency: o.id }))}
              className={`rounded-2xl border-2 p-3 text-left ${
                f.payout_frequency === o.id
                  ? "border-brand bg-brand-soft"
                  : "border-brand-soft bg-white"
              }`}
            >
              <div className="font-bold">{o.label}</div>
              <div className="text-xs text-ink-soft">{o.desc}</div>
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-brand-soft/40 p-3 text-xs text-ink-soft">
          Komisyon pa livrezon an: <b>{formatHTG(Number(d?.commission_rate ?? 100))}</b>. Sèl yon
          administratè NK ka chanje montan sa a.
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

function FieldD({
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
        className="w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand"
      />
    </label>
  );
}

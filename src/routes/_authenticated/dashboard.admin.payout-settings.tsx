import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Wallet } from "lucide-react";
import { inputCls } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard/admin/payout-settings")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminPayoutSettings,
});

function AdminPayoutSettings() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    moncash_number: "",
    moncash_account_name: "",
    natcash_number: "",
    natcash_account_name: "",
  });
  const [loaded, setLoaded] = useState(false);

  const settings = useQuery({
    queryKey: ["platform-payout-settings"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_platform_payout_public");
      if (error) throw error;
      return Array.isArray(data) ? data[0] : data;
    },
  });

  useEffect(() => {
    if (!loaded && settings.data) {
      setForm({
        moncash_number: settings.data.moncash_number ?? "",
        moncash_account_name: settings.data.moncash_account_name ?? "",
        natcash_number: settings.data.natcash_number ?? "",
        natcash_account_name: settings.data.natcash_account_name ?? "",
      });
      setLoaded(true);
    }
  }, [loaded, settings.data]);

  const save = useMutation({
    mutationFn: async () => {
      // The generator types these args as non-nullable `string` because the
      // SQL params lack a `DEFAULT NULL` marker it recognizes — Postgres
      // accepts NULL for a plain `text` param regardless, so this cast just
      // corrects an overly-strict generated type, no behavior change.
      const { error } = await supabase.rpc("update_platform_payout_settings_secure", {
        _moncash_number: (form.moncash_number || null) as string,
        _moncash_account_name: (form.moncash_account_name || null) as string,
        _natcash_number: (form.natcash_number || null) as string,
        _natcash_account_name: (form.natcash_account_name || null) as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Paramèt peman anrejistre");
      qc.invalidateQueries({ queryKey: ["platform-payout-settings"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">
            Peman platfòm (fallback)
          </h1>
          <p className="mt-1 text-ink-soft">
            Nimewo sa yo itilize nan checkout lè yon restoran poko konfigire pwòp kont peman dirèk
            li.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-6 shadow-sm">
        {settings.isLoading ? (
          <div className="text-sm text-ink-soft">Chajman…</div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold">
                <Wallet className="h-4 w-4" /> MonCash
              </h2>
              <label
                htmlFor="moncash-number"
                className="mb-1 block text-xs font-bold uppercase text-ink-soft"
              >
                Nimewo
              </label>
              <input
                id="moncash-number"
                value={form.moncash_number}
                onChange={(e) => setForm({ ...form, moncash_number: e.target.value })}
                placeholder="+509 ...."
                className={inputCls()}
              />
              <label
                htmlFor="moncash-account-name"
                className="mb-1 mt-3 block text-xs font-bold uppercase text-ink-soft"
              >
                Non kont lan
              </label>
              <input
                id="moncash-account-name"
                value={form.moncash_account_name}
                onChange={(e) => setForm({ ...form, moncash_account_name: e.target.value })}
                className={inputCls()}
              />
            </div>
            <div>
              <h2 className="mb-2 flex items-center gap-1.5 font-display text-sm font-bold">
                <Wallet className="h-4 w-4" /> NatCash
              </h2>
              <label
                htmlFor="natcash-number"
                className="mb-1 block text-xs font-bold uppercase text-ink-soft"
              >
                Nimewo
              </label>
              <input
                id="natcash-number"
                value={form.natcash_number}
                onChange={(e) => setForm({ ...form, natcash_number: e.target.value })}
                placeholder="+509 ...."
                className={inputCls()}
              />
              <label
                htmlFor="natcash-account-name"
                className="mb-1 mt-3 block text-xs font-bold uppercase text-ink-soft"
              >
                Non kont lan
              </label>
              <input
                id="natcash-account-name"
                value={form.natcash_account_name}
                onChange={(e) => setForm({ ...form, natcash_account_name: e.target.value })}
                className={inputCls()}
              />
            </div>
          </div>
        )}
        <button
          disabled={save.isPending || settings.isLoading}
          onClick={() => save.mutate()}
          className="mt-6 rounded-full bg-brand px-6 py-3 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
        >
          {save.isPending ? "Ap sove…" : "Sove paramèt yo"}
        </button>
      </section>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, type DataTableColumn } from "@/components/dashboard/tables/data-table";
import { EmptyState } from "@/components/dashboard/cards/empty-state";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { inputClsCompact } from "@/lib/utils";
import { formatHTG } from "@/lib/format";
import { useReauth, isStepUpError } from "@/hooks/useReauth";
import { stepUpErrorMessage } from "@/lib/admin-step-up";
import { ReauthDialog } from "@/components/reauth-dialog";

// Role guard lives on the parent layout (dashboard.admin.tsx), same
// convention as every other admin route in this section.
export const Route = createFileRoute("/_authenticated/dashboard/admin/withdrawal-rules")({
  component: AdminWithdrawalRules,
});

type WithdrawalRuleRow = {
  id: string;
  role: string;
  fee_percentage: number;
  flat_fee: number;
  min_amount: number;
  max_amount: number | null;
  daily_limit: number | null;
  weekly_limit: number | null;
  free_threshold: number | null;
  availability_delay_hours: number;
  effective_from: string;
  created_at: string;
  notes: string | null;
};

const ROLE_LABEL: Record<string, string> = { restaurant: "Restoran", driver: "Livrè" };

const EMPTY_FORM = {
  role: "restaurant" as "restaurant" | "driver",
  fee_percentage: "0",
  flat_fee: "0",
  min_amount: "250",
  max_amount: "",
  daily_limit: "50000",
  weekly_limit: "",
  free_threshold: "",
  availability_delay_hours: "0",
  notes: "",
};

/**
 * Tach 3D — "Règ Retrè": admin-configurable withdrawal commission rules
 * (percentage/flat fee per role, min/max per withdrawal, daily/weekly
 * limits, free threshold, availability delay). Every save is a brand
 * NEW versioned row (create_withdrawal_rule_secure INSERTs, never
 * UPDATEs) — the table below is the full history, most recent first,
 * never edited in place, so a past withdrawal's snapshotted rule
 * (payouts.withdrawal_rule_id) never silently changes meaning.
 */
function AdminWithdrawalRules() {
  const qc = useQueryClient();
  const { withReauth, invalidateStepUp, dialogState } = useReauth();
  const [form, setForm] = useState(EMPTY_FORM);

  const rules = useQuery({
    queryKey: ["admin-withdrawal-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("withdrawal_rules")
        .select(
          "id, role, fee_percentage, flat_fee, min_amount, max_amount, daily_limit, weekly_limit, free_threshold, availability_delay_hours, effective_from, created_at, notes",
        )
        .order("effective_from", { ascending: false });
      if (error) throw error;
      return data as WithdrawalRuleRow[];
    },
  });

  const activeByRole = new Map<string, WithdrawalRuleRow>();
  for (const r of rules.data ?? []) {
    if (new Date(r.effective_from) > new Date()) continue;
    const current = activeByRole.get(r.role);
    if (!current || new Date(r.effective_from) > new Date(current.effective_from)) {
      activeByRole.set(r.role, r);
    }
  }

  const create = useMutation({
    mutationFn: async () => {
      const feePercentage = Number(form.fee_percentage);
      const flatFee = Number(form.flat_fee);
      const minAmount = Number(form.min_amount);
      if (Number.isNaN(feePercentage) || feePercentage < 0 || feePercentage > 100) {
        throw new Error("Pousantaj frè envalid (0-100)");
      }
      if (Number.isNaN(flatFee) || flatFee < 0) throw new Error("Frè fiks envalid");
      if (Number.isNaN(minAmount) || minAmount < 0) throw new Error("Montan minimòm envalid");

      const { error } = await supabase.rpc("create_withdrawal_rule_secure", {
        _role: form.role,
        _fee_percentage: feePercentage,
        _flat_fee: flatFee,
        _min_amount: minAmount,
        _max_amount: form.max_amount ? Number(form.max_amount) : undefined,
        _daily_limit: form.daily_limit ? Number(form.daily_limit) : undefined,
        _weekly_limit: form.weekly_limit ? Number(form.weekly_limit) : undefined,
        _free_threshold: form.free_threshold ? Number(form.free_threshold) : undefined,
        _availability_delay_hours: Number(form.availability_delay_hours) || 0,
        _notes: form.notes.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nouvo vèsyon règ retrè anrejistre — li aktif imedyatman.");
      setForm((f) => ({ ...EMPTY_FORM, role: f.role }));
      qc.invalidateQueries({ queryKey: ["admin-withdrawal-rules"] });
    },
    onError: (e) => {
      if (isStepUpError(e)) {
        invalidateStepUp("strict");
        toast.error(stepUpErrorMessage(e));
        return;
      }
      toast.error(e.message ?? "Erè");
    },
  });

  const columns: DataTableColumn<WithdrawalRuleRow>[] = [
    {
      key: "role",
      header: "Wòl",
      cell: (r) => (
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-ink">{ROLE_LABEL[r.role] ?? r.role}</span>
          {activeByRole.get(r.role)?.id === r.id && <StatusBadge tone="good">Aktif</StatusBadge>}
        </div>
      ),
    },
    { key: "fee_percentage", header: "Frè %", cell: (r) => `${r.fee_percentage}%` },
    { key: "flat_fee", header: "Frè fiks", cell: (r) => formatHTG(r.flat_fee) },
    { key: "min_amount", header: "Min", cell: (r) => formatHTG(r.min_amount) },
    {
      key: "max_amount",
      header: "Max",
      cell: (r) => (r.max_amount != null ? formatHTG(r.max_amount) : "—"),
      hideOnMobileCard: true,
    },
    {
      key: "daily_limit",
      header: "Limit/jou",
      cell: (r) => (r.daily_limit != null ? formatHTG(r.daily_limit) : "—"),
      hideOnMobileCard: true,
    },
    {
      key: "weekly_limit",
      header: "Limit/sem",
      cell: (r) => (r.weekly_limit != null ? formatHTG(r.weekly_limit) : "—"),
      hideOnMobileCard: true,
    },
    {
      key: "free_threshold",
      header: "Sèy gratis",
      cell: (r) => (r.free_threshold != null ? formatHTG(r.free_threshold) : "—"),
      hideOnMobileCard: true,
    },
    {
      key: "availability_delay_hours",
      header: "Delè",
      cell: (r) => (r.availability_delay_hours > 0 ? `${r.availability_delay_hours} è` : "—"),
      hideOnMobileCard: true,
    },
    {
      key: "effective_from",
      header: "Aktif depi",
      cell: (r) => new Date(r.effective_from).toLocaleString("fr-HT"),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-display text-3xl font-extrabold text-ink">
            <SlidersHorizontal className="h-7 w-7 text-brand-deep" /> Règ Retrè
          </h1>
          <p className="mt-1 text-ink-soft">
            Frè ak limit pou demann retrè pwòp-tèt (restoran/livrè) — chak sovgad kreye yon NOUVO
            vèsyon, retrè ki deja fèt yo kenbe règ ki te aplike lè yo te fèt.
          </p>
        </div>
        <Link
          to="/dashboard/admin/payouts"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dekesman
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold text-ink">Nouvo vèsyon règ</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Wòl</span>
            <select
              value={form.role}
              onChange={(e) =>
                setForm((f) => ({ ...f, role: e.target.value as "restaurant" | "driver" }))
              }
              className={inputClsCompact()}
            >
              <option value="restaurant">Restoran</option>
              <option value="driver">Livrè</option>
            </select>
          </label>
          <Field
            label="Frè pousantaj (%)"
            value={form.fee_percentage}
            onChange={(v) => setForm((f) => ({ ...f, fee_percentage: v }))}
          />
          <Field
            label="Frè fiks (HTG)"
            value={form.flat_fee}
            onChange={(v) => setForm((f) => ({ ...f, flat_fee: v }))}
          />
          <Field
            label="Montan minimòm (HTG)"
            value={form.min_amount}
            onChange={(v) => setForm((f) => ({ ...f, min_amount: v }))}
          />
          <Field
            label="Montan maksimòm (opsyonèl)"
            value={form.max_amount}
            onChange={(v) => setForm((f) => ({ ...f, max_amount: v }))}
          />
          <Field
            label="Limit chak jou (opsyonèl)"
            value={form.daily_limit}
            onChange={(v) => setForm((f) => ({ ...f, daily_limit: v }))}
          />
          <Field
            label="Limit chak semèn (opsyonèl)"
            value={form.weekly_limit}
            onChange={(v) => setForm((f) => ({ ...f, weekly_limit: v }))}
          />
          <Field
            label="Sèy gratis (opsyonèl)"
            value={form.free_threshold}
            onChange={(v) => setForm((f) => ({ ...f, free_threshold: v }))}
          />
          <Field
            label="Delè disponibilite (è)"
            value={form.availability_delay_hours}
            onChange={(v) => setForm((f) => ({ ...f, availability_delay_hours: v }))}
          />
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
            Nòt (opsyonèl)
          </span>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            className={inputClsCompact()}
          />
        </label>
        <p className="mt-3 text-xs text-ink-soft">
          Yon retrè {"<="} sèy gratis la peye ZEWO frè. San sèy, chak retrè peye pousantaj + frè
          fiks. Delè disponibilite a se konbyen tan apre yon demann anvan li ka trete (otomatik oswa
          manyèl) — pa yon delè sou balans lan.
        </p>
        <Button
          className="mt-4 font-display font-extrabold"
          disabled={create.isPending}
          onClick={() => withReauth(() => create.mutate(), "strict")}
        >
          {create.isPending ? "Ap anrejistre…" : "Sove kòm nouvo vèsyon"}
        </Button>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Istorik vèsyon yo</h2>
        <DataTable<WithdrawalRuleRow>
          rows={rules.data ?? []}
          getRowKey={(r) => r.id}
          loading={rules.isLoading}
          mobileTitleKey="role"
          emptyState={
            <EmptyState
              icon={SlidersHorizontal}
              title="Pa gen règ"
              description="Pa gen okenn règ retrè konfigire toujou."
            />
          }
          columns={columns}
        />
      </section>

      <ReauthDialog state={dialogState} />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClsCompact()}
      />
    </label>
  );
}

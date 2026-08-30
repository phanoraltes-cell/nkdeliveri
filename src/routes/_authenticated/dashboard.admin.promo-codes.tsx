import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { formatHTG } from "@/lib/format";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";

type PromoCode = Database["public"]["Tables"]["promo_codes"]["Row"];

// Wòl gaded pa dashboard.admin.tsx (layout paran an, admin+super_admin) —
// menm jan ak dashboard.admin.refunds.tsx elatriye, pa gen gad lokal isit
// la ki ta redondan.
export const Route = createFileRoute("/_authenticated/dashboard/admin/promo-codes")({
  component: AdminPromoCodes,
});

function AdminPromoCodes() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PromoCode | null>(null);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  const codes = useQuery({
    queryKey: ["admin-promo-codes"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_promo_codes_admin");
      if (error) throw error;
      return data;
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (p: PromoCode) => {
      const { error } = await supabase.rpc("update_promo_code_secure", {
        _id: p.id,
        _discount_type: p.discount_type,
        _discount_value: p.discount_value,
        _min_order_amount: p.min_order_amount as number,
        _max_uses: p.max_uses as number,
        _starts_at: p.starts_at as string,
        _ends_at: p.ends_at as string,
        _active: !p.active,
      });
      if (error) throw error;
    },
    onSuccess: (_data, p) => {
      qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
      toast.success(p.active ? "Kòd pwomo dezaktive" : "Kòd pwomo aktive");
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_promo_code_secure", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Kòd pwomo efase");
      qc.invalidateQueries({ queryKey: ["admin-promo-codes"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Kòd Pwomo</h1>
          <p className="mt-1 text-ink-soft">
            Kòd rabè platfòm-antye kliyan antre yo nan checkout la.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
      </div>

      <Button
        onClick={() => {
          setEditing(null);
          setShowForm(true);
        }}
      >
        <Plus className="h-4 w-4" /> Nouvo kòd pwomo
      </Button>

      {showForm && (
        <PromoCodeForm
          promo={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-promo-codes"] })}
        />
      )}

      <div className="space-y-3">
        {codes.data?.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-display text-lg font-extrabold">
                  {p.code}
                  <StatusBadge tone={p.active ? "good" : "neutral"}>
                    {p.active ? "Aktif" : "Dezaktive"}
                  </StatusBadge>
                </div>
                <div className="mt-1 text-sm font-bold text-brand-deep">
                  {p.discount_type === "percentage"
                    ? `${p.discount_value}% rabè`
                    : `${formatHTG(p.discount_value)} rabè`}
                  {p.min_order_amount != null && (
                    <span className="ml-2 text-xs font-normal text-ink-soft">
                      (min {formatHTG(p.min_order_amount)})
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-ink-soft">
                  Itilize: {p.uses_count}
                  {p.max_uses != null ? ` / ${p.max_uses}` : ""}
                </div>
                {(p.starts_at || p.ends_at) && (
                  <div className="mt-1 text-xs text-ink-soft">
                    {p.starts_at ? new Date(p.starts_at).toLocaleDateString("fr-HT") : "…"}
                    {" → "}
                    {p.ends_at ? new Date(p.ends_at).toLocaleDateString("fr-HT") : "san fen"}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => toggleActive.mutate(p)}
                  className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                >
                  {p.active ? "Dezaktive" : "Aktive"}
                </button>
                <button
                  onClick={() => {
                    setEditing(p);
                    setShowForm(true);
                  }}
                  className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                >
                  Modifye
                </button>
                <button
                  onClick={() =>
                    requestConfirm(`Efase kòd "${p.code}"?`, () => remove.mutate(p.id))
                  }
                  aria-label={`Efase kòd pwomo "${p.code}"`}
                  className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 transition hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {codes.data?.length === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Poko gen okenn kòd pwomo.
          </div>
        )}
      </div>
      {ConfirmDialog}
    </div>
  );
}

function PromoCodeForm({
  promo,
  onClose,
  onSaved,
}: {
  promo: PromoCode | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    code: promo?.code ?? "",
    discount_type: promo?.discount_type ?? "percentage",
    discount_value: promo?.discount_value ? String(promo.discount_value) : "",
    min_order_amount: promo?.min_order_amount ? String(promo.min_order_amount) : "",
    max_uses: promo?.max_uses ? String(promo.max_uses) : "",
    starts_at: promo?.starts_at ? promo.starts_at.slice(0, 10) : "",
    ends_at: promo?.ends_at ? promo.ends_at.slice(0, 10) : "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!promo && !f.code.trim()) return toast.error("Kòd pwomo a obligatwa");
    const value = Number(f.discount_value);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Valè rabè a envalid");
    if (f.discount_type === "percentage" && value > 100)
      return toast.error("Rabè an pousantaj pa ka depase 100%");
    setSaving(true);
    try {
      const args = {
        _discount_type: f.discount_type,
        _discount_value: value,
        _min_order_amount: (f.min_order_amount ? Number(f.min_order_amount) : null) as number,
        _max_uses: (f.max_uses ? Number(f.max_uses) : null) as number,
        _starts_at: (f.starts_at ? new Date(f.starts_at).toISOString() : null) as string,
        _ends_at: (f.ends_at ? new Date(f.ends_at).toISOString() : null) as string,
      };
      if (promo) {
        const { error } = await supabase.rpc("update_promo_code_secure", {
          _id: promo.id,
          ...args,
          _active: promo.active,
        });
        if (error) throw error;
        toast.success("Kòd pwomo mizajou");
      } else {
        const { error } = await supabase.rpc("create_promo_code_secure", {
          _code: f.code.trim(),
          ...args,
        });
        if (error) throw error;
        toast.success("Kòd pwomo kreye");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">
          {promo ? "Modifye kòd pwomo" : "Nouvo kòd pwomo"}
        </h3>
        <button onClick={onClose} aria-label="Fèmen" className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          placeholder="Kòd (ex: BYENVENI20)"
          aria-label="Kòd pwomo"
          disabled={!!promo}
          className={inputCls() + " sm:col-span-2" + (promo ? " opacity-60" : "")}
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
        />
        <select
          aria-label="Tip rabè"
          className={inputCls()}
          value={f.discount_type}
          onChange={(e) => setF({ ...f, discount_type: e.target.value })}
        >
          <option value="percentage">Pousantaj (%)</option>
          <option value="fixed">Montan fiks (HTG)</option>
        </select>
        <input
          placeholder={f.discount_type === "percentage" ? "Valè (ex: 15)" : "Valè (ex: 100)"}
          aria-label="Valè rabè a"
          type="number"
          min="0"
          className={inputCls()}
          value={f.discount_value}
          onChange={(e) => setF({ ...f, discount_value: e.target.value })}
        />
        <input
          placeholder="Kòmand minimòm (opsyonèl)"
          aria-label="Kòmand minimòm"
          type="number"
          min="0"
          className={inputCls()}
          value={f.min_order_amount}
          onChange={(e) => setF({ ...f, min_order_amount: e.target.value })}
        />
        <input
          placeholder="Kantite maksimòm itilizasyon (opsyonèl)"
          aria-label="Kantite maksimòm itilizasyon"
          type="number"
          min="1"
          className={inputCls()}
          value={f.max_uses}
          onChange={(e) => setF({ ...f, max_uses: e.target.value })}
        />
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Kòmanse</span>
          <input
            type="date"
            className={inputCls()}
            value={f.starts_at}
            onChange={(e) => setF({ ...f, starts_at: e.target.value })}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Fini</span>
          <input
            type="date"
            className={inputCls()}
            value={f.ends_at}
            onChange={(e) => setF({ ...f, ends_at: e.target.value })}
          />
        </label>
      </div>
      <Button className="mt-4" disabled={saving} onClick={save}>
        {saving ? "Ap sove…" : "Sove kòd pwomo"}
      </Button>
    </div>
  );
}

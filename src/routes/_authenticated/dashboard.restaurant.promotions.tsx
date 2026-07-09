import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";

type Promotion = Database["public"]["Tables"]["promotions"]["Row"];

export const Route = createFileRoute("/_authenticated/dashboard/restaurant/promotions")({
  beforeLoad: ({ context }) => {
    const { role } = context;
    if (role !== "restaurant_owner" && role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: RestaurantPromotions,
});

function inputCls() {
  return "w-full rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand";
}

function RestaurantPromotions() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);

  const { data: restaurant } = useQuery({
    queryKey: ["me-restaurant-id", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("restaurants").select("id").eq("owner_id", user!.id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const promos = useQuery({
    queryKey: ["restaurant-promotions", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promotions")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Promotion) => {
      // The generator types these args as non-nullable because the SQL
      // params lack a `DEFAULT NULL` marker it recognizes — Postgres accepts
      // NULL for these columns regardless, so these casts just correct an
      // overly-strict generated type, no behavior change.
      const { error } = await supabase.rpc("update_promotion_secure", {
        _promotion_id: p.id, _title: p.title, _description: p.description as string, _discount_type: p.discount_type,
        _discount_value: p.discount_value, _code: p.code as string, _starts_at: p.starts_at as string, _ends_at: p.ends_at as string,
        _active: !p.active,
      });
      if (error) throw error;
    },
    onSuccess: (_data, p) => {
      qc.invalidateQueries({ queryKey: ["restaurant-promotions"] });
      toast.success(p.active ? "Pwomosyon dezaktive" : "Pwomosyon aktive");
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_promotion_secure", { _promotion_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Pwomosyon efase"); qc.invalidateQueries({ queryKey: ["restaurant-promotions"] }); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Pwomosyon</h1>
          <p className="mt-1 text-ink-soft">Kreye ofri espesyal pou atire plis kliyan.</p>
        </div>
        <Link to="/dashboard/restaurant" className="text-sm font-bold text-brand-deep hover:underline">← Dashboard</Link>
      </div>

      <button
        onClick={() => { setEditing(null); setShowForm(true); }}
        className="inline-flex items-center gap-1 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white hover:bg-brand-deep"
      >
        <Plus className="h-4 w-4" /> Nouvo pwomosyon
      </button>

      {showForm && restaurant && (
        <PromoForm
          restaurantId={restaurant.id}
          promo={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["restaurant-promotions"] })}
        />
      )}

      <div className="space-y-3">
        {promos.data?.map((p) => (
          <div key={p.id} className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-display text-lg font-extrabold">
                  {p.title}
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${p.active ? "bg-emerald-100 text-emerald-800" : "bg-ink/10 text-ink-soft"}`}>
                    {p.active ? "Aktif" : "Dezaktive"}
                  </span>
                </div>
                {p.description && <div className="text-sm text-ink-soft">{p.description}</div>}
                <div className="mt-1 text-sm font-bold text-brand-deep">
                  {p.discount_type === "percentage" ? `${p.discount_value}% rabè` : `${p.discount_value} HTG rabè`}
                  {p.code && <span className="ml-2 rounded bg-brand-soft/60 px-2 py-0.5 text-xs">Kòd: {p.code}</span>}
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
                  onClick={() => { setEditing(p); setShowForm(true); }}
                  className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                >
                  Modifye
                </button>
                <button
                  onClick={() => { if (confirm(`Efase "${p.title}"?`)) remove.mutate(p.id); }}
                  className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {promos.data?.length === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Ou poko gen okenn pwomosyon.
          </div>
        )}
      </div>
    </div>
  );
}

function PromoForm({
  restaurantId, promo, onClose, onSaved,
}: { restaurantId: string; promo: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    title: promo?.title ?? "",
    description: promo?.description ?? "",
    discount_type: promo?.discount_type ?? "percentage",
    discount_value: promo?.discount_value ? String(promo.discount_value) : "",
    code: promo?.code ?? "",
    starts_at: promo?.starts_at ? promo.starts_at.slice(0, 10) : "",
    ends_at: promo?.ends_at ? promo.ends_at.slice(0, 10) : "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.title.trim()) return toast.error("Tit pwomosyon an obligatwa");
    const value = Number(f.discount_value);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Valè rabè a envalid");
    if (f.discount_type === "percentage" && value > 100) return toast.error("Rabè an pousantaj pa ka depase 100%");
    setSaving(true);
    try {
      // The generator types these args as non-nullable because the SQL
      // params lack a `DEFAULT NULL` marker it recognizes — Postgres accepts
      // NULL for these columns regardless, so these casts just correct an
      // overly-strict generated type, no behavior change.
      const args = {
        _title: f.title.trim(),
        _description: (f.description || null) as string,
        _discount_type: f.discount_type,
        _discount_value: value,
        _code: (f.code || null) as string,
        _starts_at: (f.starts_at ? new Date(f.starts_at).toISOString() : null) as string,
        _ends_at: (f.ends_at ? new Date(f.ends_at).toISOString() : null) as string,
      };
      if (promo) {
        const { error } = await supabase.rpc("update_promotion_secure", {
          _promotion_id: promo.id, ...args, _active: promo.active,
        });
        if (error) throw error;
        toast.success("Pwomosyon mizajou");
      } else {
        const { error } = await supabase.rpc("create_promotion_secure", {
          _restaurant_id: restaurantId, ...args,
        });
        if (error) throw error;
        toast.success("Pwomosyon kreye");
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
        <h3 className="font-display font-bold">{promo ? "Modifye pwomosyon" : "Nouvo pwomosyon"}</h3>
        <button onClick={onClose} className="text-ink-soft hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input placeholder="Tit (ex: 20% sou premye kòmand)" className={inputCls() + " sm:col-span-2"} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <select className={inputCls()} value={f.discount_type} onChange={(e) => setF({ ...f, discount_type: e.target.value })}>
          <option value="percentage">Pousantaj (%)</option>
          <option value="fixed">Montan fiks (HTG)</option>
        </select>
        <input placeholder={f.discount_type === "percentage" ? "Valè (ex: 15)" : "Valè (ex: 100)"} type="number" min="0" className={inputCls()} value={f.discount_value} onChange={(e) => setF({ ...f, discount_value: e.target.value })} />
        <input placeholder="Kòd pwomo (opsyonèl)" className={inputCls()} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} />
        <div />
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Kòmanse</span>
          <input type="date" className={inputCls()} value={f.starts_at} onChange={(e) => setF({ ...f, starts_at: e.target.value })} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Fini</span>
          <input type="date" className={inputCls()} value={f.ends_at} onChange={(e) => setF({ ...f, ends_at: e.target.value })} />
        </label>
        <textarea placeholder="Deskripsyon (opsyonèl)" rows={2} className={inputCls() + " sm:col-span-2"} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      <button
        disabled={saving}
        onClick={save}
        className="mt-4 rounded-full bg-brand px-6 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
      >
        {saving ? "Ap sove…" : "Sove pwomosyon"}
      </button>
    </div>
  );
}

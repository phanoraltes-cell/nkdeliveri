import { createFileRoute, Link } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { sendNewPromotionPush } from "@/lib/send-promotion-push.functions";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";

type Promotion = Database["public"]["Tables"]["promotions"]["Row"];

// Owner-only: intentionally narrower than the parent layout's owner+staff
// guard — promotions affect pricing/marketing, reserved for the owner. Not
// redundant with the layout's guard, do not remove it.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant/promotions")({
  beforeLoad: ({ context }) => {
    requireRole(context.allRoles, ["restaurant_owner", "admin", "super_admin"]);
  },
  component: RestaurantPromotions,
});

function RestaurantPromotions() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

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

  const promos = useQuery({
    queryKey: ["restaurant-promotions", restaurant?.id],
    enabled: !!restaurant?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("promotions")
        .select("*")
        .eq("restaurant_id", restaurant!.id)
        .order("created_at", { ascending: false })
        // A single restaurant's own promotions are never going to number in
        // the hundreds in practice — this is a safety cap against a
        // pathological case, not full pagination (which this list doesn't
        // need at its actual scale).
        .limit(100);
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
      // Pase TOUT chan yo, ni sa toggleActive pa touche (scope/dish_ids/
      // auto_apply) — update_promotion_secure ekri chak paramèt li resevwa
      // san kondisyon, donk yon apèl ki OMÈT yo ta REYINISYALIZE yo sou
      // valè default (menu/NULL/false), efase konfigirasyon aplikasyon
      // otomatik pwopriyetè a te deja mete.
      const { error } = await supabase.rpc("update_promotion_secure", {
        _promotion_id: p.id,
        _title: p.title,
        _description: p.description as string,
        _discount_type: p.discount_type,
        _discount_value: p.discount_value,
        _code: p.code as string,
        _starts_at: p.starts_at as string,
        _ends_at: p.ends_at as string,
        _active: !p.active,
        _scope: p.scope,
        _dish_ids: p.dish_ids as string[],
        _auto_apply: p.auto_apply,
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
    onSuccess: () => {
      toast.success("Pwomosyon efase");
      qc.invalidateQueries({ queryKey: ["restaurant-promotions"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Pwomosyon</h1>
          <p className="mt-1 text-ink-soft">Kreye ofri espesyal pou atire plis kliyan.</p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <Button
        onClick={() => {
          setEditing(null);
          setShowForm(true);
        }}
      >
        <Plus className="h-4 w-4" /> Nouvo pwomosyon
      </Button>

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
          <div
            key={p.id}
            className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-display text-lg font-extrabold">
                  {p.title}
                  <StatusBadge tone={p.active ? "good" : "neutral"}>
                    {p.active ? "Aktif" : "Dezaktive"}
                  </StatusBadge>
                  {p.auto_apply && <StatusBadge tone="info">Otomatik</StatusBadge>}
                </div>
                {p.description && <div className="text-sm text-ink-soft">{p.description}</div>}
                <div className="mt-1 text-sm font-bold text-brand-deep">
                  {p.discount_type === "percentage"
                    ? `${p.discount_value}% rabè`
                    : `${p.discount_value} HTG rabè`}
                  {p.code && (
                    <span className="ml-2 rounded bg-brand-soft/60 px-2 py-0.5 text-xs">
                      Kòd: {p.code}
                    </span>
                  )}
                  <span className="ml-2 text-xs font-normal text-ink-soft">
                    {p.scope === "dish" ? `${p.dish_ids?.length ?? 0} plat sible` : "Tout meni an"}
                  </span>
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
                  onClick={() => requestConfirm(`Efase "${p.title}"?`, () => remove.mutate(p.id))}
                  aria-label={`Efase pwomosyon "${p.title}"`}
                  className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 transition hover:bg-red-50"
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
      {ConfirmDialog}
    </div>
  );
}

function PromoForm({
  restaurantId,
  promo,
  onClose,
  onSaved,
}: {
  restaurantId: string;
  promo: Promotion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    title: promo?.title ?? "",
    description: promo?.description ?? "",
    discount_type: promo?.discount_type ?? "percentage",
    discount_value: promo?.discount_value ? String(promo.discount_value) : "",
    code: promo?.code ?? "",
    starts_at: promo?.starts_at ? promo.starts_at.slice(0, 10) : "",
    ends_at: promo?.ends_at ? promo.ends_at.slice(0, 10) : "",
    scope: promo?.scope ?? "menu",
    dish_ids: (promo?.dish_ids as string[] | null) ?? [],
    auto_apply: promo?.auto_apply ?? false,
  });
  const [saving, setSaving] = useState(false);
  const sendPromotionPush = useServerFn(sendNewPromotionPush);

  // Tach 3 — lis plat pou pikè "plat espesifik" la. Chaje sèlman lè fòm lan
  // ouvè (restaurantId toujou disponib) — yon restoran ki gen anpil plat
  // pa dwe peye kou rekèt sa a si li pa janm bezwen sible yon plat espesifik.
  const products = useQuery({
    queryKey: ["restaurant-products-for-promo", restaurantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name")
        .eq("restaurant_id", restaurantId)
        .is("archived_at", null)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  function toggleDish(id: string) {
    setF((prev) => ({
      ...prev,
      dish_ids: prev.dish_ids.includes(id)
        ? prev.dish_ids.filter((d) => d !== id)
        : [...prev.dish_ids, id],
    }));
  }

  async function save() {
    if (!f.title.trim()) return toast.error("Tit pwomosyon an obligatwa");
    const value = Number(f.discount_value);
    if (!Number.isFinite(value) || value <= 0) return toast.error("Valè rabè a envalid");
    if (f.discount_type === "percentage" && value > 100)
      return toast.error("Rabè an pousantaj pa ka depase 100%");
    if (f.scope === "dish" && f.dish_ids.length === 0)
      return toast.error("Chwazi omwen yon plat pou yon pwomosyon plat espesifik");
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
        _scope: f.scope,
        _dish_ids: f.scope === "dish" ? f.dish_ids : undefined,
        _auto_apply: f.auto_apply,
      };
      if (promo) {
        const { error } = await supabase.rpc("update_promotion_secure", {
          _promotion_id: promo.id,
          ...args,
          _active: promo.active,
        });
        if (error) throw error;
        toast.success("Pwomosyon mizajou");
      } else {
        const { data: row, error } = await supabase.rpc("create_promotion_secure", {
          _restaurant_id: restaurantId,
          ...args,
        });
        if (error) throw error;
        toast.success("Pwomosyon kreye");
        try {
          await sendPromotionPush({ data: { promotionId: row.id } });
        } catch (e) {
          console.warn("push send failed", e);
        }
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
          {promo ? "Modifye pwomosyon" : "Nouvo pwomosyon"}
        </h3>
        <button onClick={onClose} aria-label="Fèmen" className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          placeholder="Tit (ex: 20% sou premye kòmand)"
          aria-label="Tit pwomosyon an"
          className={inputCls() + " sm:col-span-2"}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
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
          placeholder="Kòd pwomo (opsyonèl)"
          aria-label="Kòd pwomo (opsyonèl)"
          className={inputCls()}
          value={f.code}
          onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })}
        />
        <div />
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
        <textarea
          placeholder="Deskripsyon (opsyonèl)"
          aria-label="Deskripsyon (opsyonèl)"
          rows={2}
          className={inputCls() + " sm:col-span-2"}
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </div>

      {/* Tach 3 — aplikasyon otomatik nan pri a. Separe de tout chan pi wo
          yo (ki te toujou la, pi wo, sèlman pou afichaj/anons) paske sa a
          gen yon vrè konsekans finansye: si aktive, rabè a soustrè de pri
          reyèl kliyan peye a, san yo pa antre okenn kòd. */}
      <div className="mt-3 rounded-xl border-2 border-dashed border-brand-soft p-3">
        <label className="flex items-start gap-2 text-sm font-bold">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={f.auto_apply}
            onChange={(e) => setF({ ...f, auto_apply: e.target.checked })}
          />
          <span>
            Aplike rabè a otomatikman nan pri a
            <span className="mt-0.5 block text-xs font-normal text-ink-soft">
              Kliyan pa bezwen antre okenn kòd — rabè a soustrè dirèkteman. San sa, pwomosyon an
              rete yon senp anons/bannyè.
            </span>
          </span>
        </label>

        {f.auto_apply && (
          <div className="mt-3">
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Sible</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setF({ ...f, scope: "menu" })}
                className={`rounded-lg border-2 px-3 py-1.5 text-xs font-bold ${
                  f.scope === "menu"
                    ? "border-brand bg-brand-soft text-brand-deep"
                    : "border-brand-soft text-ink-soft"
                }`}
              >
                Tout meni an
              </button>
              <button
                type="button"
                onClick={() => setF({ ...f, scope: "dish" })}
                className={`rounded-lg border-2 px-3 py-1.5 text-xs font-bold ${
                  f.scope === "dish"
                    ? "border-brand bg-brand-soft text-brand-deep"
                    : "border-brand-soft text-ink-soft"
                }`}
              >
                Plat espesifik
              </button>
            </div>

            {f.scope === "dish" && (
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-brand-soft/60 p-2">
                {products.data?.length ? (
                  products.data.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={f.dish_ids.includes(p.id)}
                        onChange={() => toggleDish(p.id)}
                      />
                      {p.name}
                    </label>
                  ))
                ) : (
                  <div className="text-xs text-ink-soft">Ou pa gen plat nan meni w ankò.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Button className="mt-4" disabled={saving} onClick={save}>
        {saving ? "Ap sove…" : "Sove pwomosyon"}
      </Button>
    </div>
  );
}

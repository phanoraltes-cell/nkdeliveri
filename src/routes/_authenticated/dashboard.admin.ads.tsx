import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";
import { PromotionalNotificationForm } from "@/components/dashboard/admin/promotional-notification-form";

type Placement = Database["public"]["Tables"]["sponsored_placements"]["Row"] & {
  restaurants: { name: string } | null;
};

const PLACEMENT_LABEL: Record<string, string> = {
  home_banner: "Bannyè akèy",
  search_results: "Rezilta rechèch",
  restaurant_page: "Paj restoran",
  dashboard: "Dashboard",
};

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/ads")({
  component: AdminAds,
});

function AdminAds() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Placement | null>(null);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  const placements = useQuery({
    queryKey: ["admin-sponsored-placements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sponsored_placements")
        .select("*, restaurants(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as Placement[];
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_sponsored_placement_secure", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Anons efase");
      qc.invalidateQueries({ queryKey: ["admin-sponsored-placements"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Placement) => {
      // The generator types these args as non-nullable `string` because the
      // SQL params lack a `DEFAULT NULL` marker it recognizes — Postgres
      // accepts NULL for them regardless, so these casts just correct an
      // overly-strict generated type, no behavior change.
      const { error } = await supabase.rpc("update_sponsored_placement_secure", {
        _id: p.id,
        _title: p.title,
        _starts_at: p.starts_at,
        _ends_at: p.ends_at,
        _is_active: !p.is_active,
        _image_url: p.image_url as string,
        _link_url: p.link_url as string,
        _sort_order: p.sort_order,
      });
      if (error) throw error;
    },
    onSuccess: (_data, p) => {
      toast.success(p.is_active ? "Anons dezaktive" : "Anons aktive");
      qc.invalidateQueries({ queryKey: ["admin-sponsored-placements"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const now = Date.now();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Piblisite</h1>
          <p className="mt-1 text-ink-soft">
            Jere anons sponsorize yo (bannyè akèy, rezilta rechèch, paj restoran, dashboard).
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <PromotionalNotificationForm />

      <Button
        onClick={() => {
          setEditing(null);
          setShowForm(true);
        }}
      >
        <Plus className="h-4 w-4" /> Nouvo anons
      </Button>

      {showForm && (
        <PlacementForm
          placement={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-sponsored-placements"] })}
        />
      )}

      <div className="space-y-3">
        {placements.data?.map((p) => {
          const expired = new Date(p.ends_at).getTime() < now;
          return (
            <div
              key={p.id}
              className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-display text-lg font-extrabold">
                    {p.title}
                    <StatusBadge tone="neutral">{PLACEMENT_LABEL[p.placement]}</StatusBadge>
                    <StatusBadge tone={p.is_active && !expired ? "good" : "neutral"}>
                      {expired ? "Ekspire" : p.is_active ? "Aktif" : "Dezaktive"}
                    </StatusBadge>
                  </div>
                  {p.restaurants?.name && (
                    <div className="text-sm text-ink-soft">Restoran: {p.restaurants.name}</div>
                  )}
                  <div className="mt-1 text-xs text-ink-soft">
                    {new Date(p.starts_at).toLocaleDateString("fr-HT")}
                    {" → "}
                    {new Date(p.ends_at).toLocaleDateString("fr-HT")}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleActive.mutate(p)}
                    className="rounded-lg border-2 border-brand-soft px-3 py-1 text-xs font-bold text-brand-deep hover:bg-brand-soft/40"
                  >
                    {p.is_active ? "Dezaktive" : "Aktive"}
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
                    aria-label={`Efase anons "${p.title}"`}
                    className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 transition hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {placements.data?.length === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Pa gen okenn anons.
          </div>
        )}
      </div>
      {ConfirmDialog}
    </div>
  );
}

function PlacementForm({
  placement,
  onClose,
  onSaved,
}: {
  placement: Placement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    placement: placement?.placement ?? "home_banner",
    restaurant_id: placement?.restaurant_id ?? "",
    title: placement?.title ?? "",
    image_url: placement?.image_url ?? "",
    link_url: placement?.link_url ?? "",
    starts_at: placement?.starts_at ? placement.starts_at.slice(0, 10) : "",
    ends_at: placement?.ends_at ? placement.ends_at.slice(0, 10) : "",
    sort_order: placement?.sort_order != null ? String(placement.sort_order) : "0",
  });
  const [saving, setSaving] = useState(false);

  const restaurants = useQuery({
    queryKey: ["approved-restaurants-for-ads"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name")
        .eq("status", "approved")
        .order("name")
        .limit(500);
      if (error) throw error;
      return data;
    },
  });

  async function save() {
    if (!f.title.trim()) return toast.error("Tit anons lan obligatwa");
    if (!f.starts_at || !f.ends_at) return toast.error("Chwazi dat kòmansman ak dat fen");
    const startsAt = new Date(f.starts_at).toISOString();
    const endsAt = new Date(f.ends_at + "T23:59:59").toISOString();
    if (new Date(endsAt) <= new Date(startsAt))
      return toast.error("Dat fen dwe apre dat kòmansman");
    setSaving(true);
    try {
      if (placement) {
        const { error } = await supabase.rpc("update_sponsored_placement_secure", {
          _id: placement.id,
          _title: f.title.trim(),
          _starts_at: startsAt,
          _ends_at: endsAt,
          _is_active: placement.is_active,
          _image_url: f.image_url || undefined,
          _link_url: f.link_url || undefined,
          _sort_order: Number(f.sort_order) || 0,
        });
        if (error) throw error;
        toast.success("Anons mizajou");
      } else {
        const { error } = await supabase.rpc("create_sponsored_placement_secure", {
          _placement: f.placement,
          _title: f.title.trim(),
          _starts_at: startsAt,
          _ends_at: endsAt,
          _restaurant_id: f.restaurant_id || undefined,
          _image_url: f.image_url || undefined,
          _link_url: f.link_url || undefined,
          _sort_order: Number(f.sort_order) || 0,
        });
        if (error) throw error;
        toast.success("Anons kreye");
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
        <h3 className="font-display font-bold">{placement ? "Modifye anons" : "Nouvo anons"}</h3>
        <button onClick={onClose} aria-label="Fèmen" className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <select
          aria-label="Anplasman"
          className={inputCls()}
          value={f.placement}
          disabled={!!placement}
          onChange={(e) => setF({ ...f, placement: e.target.value })}
        >
          {Object.entries(PLACEMENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          aria-label="Restoran (opsyonèl)"
          className={inputCls()}
          value={f.restaurant_id}
          disabled={!!placement}
          onChange={(e) => setF({ ...f, restaurant_id: e.target.value })}
        >
          <option value="">Okenn restoran (anons jeneral)</option>
          {restaurants.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <input
          placeholder="Tit anons lan"
          aria-label="Tit anons lan"
          className={inputCls() + " sm:col-span-2"}
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
        />
        <input
          placeholder="Imaj URL (opsyonèl)"
          aria-label="Imaj URL (opsyonèl)"
          className={inputCls()}
          value={f.image_url}
          onChange={(e) => setF({ ...f, image_url: e.target.value })}
        />
        <input
          placeholder="Lyen destinasyon (opsyonèl)"
          aria-label="Lyen destinasyon (opsyonèl)"
          className={inputCls()}
          value={f.link_url}
          onChange={(e) => setF({ ...f, link_url: e.target.value })}
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
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
            Priyorite (0 = premye)
          </span>
          <input
            type="number"
            className={inputCls()}
            value={f.sort_order}
            onChange={(e) => setF({ ...f, sort_order: e.target.value })}
          />
        </label>
      </div>
      <Button className="mt-4" disabled={saving} onClick={save}>
        {saving ? "Ap sove…" : "Sove anons"}
      </Button>
    </div>
  );
}

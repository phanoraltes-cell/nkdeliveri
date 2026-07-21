import { createFileRoute, Link } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { assertValidUploadFile } from "@/lib/file-validation";

// Owner-only: intentionally narrower than the parent layout's owner+staff
// guard — restaurant identity/settings shouldn't be editable by staff. Not
// redundant with the layout's guard, do not remove it.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant/profile")({
  beforeLoad: ({ context }) => {
    requireRole(context.role, ["restaurant_owner", "admin", "super_admin"]);
  },
  component: RestaurantProfile,
});

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Lendi" },
  { key: "tue", label: "Madi" },
  { key: "wed", label: "Mèkredi" },
  { key: "thu", label: "Jedi" },
  { key: "fri", label: "Vandredi" },
  { key: "sat", label: "Samdi" },
  { key: "sun", label: "Dimanch" },
];

async function uploadAsset(restaurantId: string, kind: "logo" | "cover", file: File) {
  assertValidUploadFile(file, "restaurant-assets");
  const path = `${restaurantId}/${kind}-${Date.now()}-${file.name}`;
  const { error } = await supabase.storage
    .from("restaurant-assets")
    .upload(path, file, { upsert: false });
  if (error) throw error;
  return supabase.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl;
}

function RestaurantProfile() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: restaurant, isLoading } = useQuery({
    queryKey: ["me-restaurant-full", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("*")
        .eq("owner_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [f, setF] = useState({ name: "", description: "", cuisine: "", phone: "", address: "" });
  const [logo, setLogo] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [hours, setHours] = useState<
    Record<string, { open: string; close: string; closed: boolean }>
  >({});

  useEffect(() => {
    if (!restaurant) return;
    setF({
      name: restaurant.name ?? "",
      description: restaurant.description ?? "",
      cuisine: restaurant.cuisine ?? "",
      phone: restaurant.phone ?? "",
      address: restaurant.address ?? "",
    });
    const h = (restaurant.opening_hours as typeof hours | null) ?? {};
    const next: typeof hours = {};
    for (const d of DAYS) {
      next[d.key] = h[d.key] ?? { open: "10:00", close: "22:00", closed: false };
    }
    setHours(next);
    // `restaurant` is intentionally omitted: this seeds the editable form
    // once when the record first loads (keyed on id), not on every
    // background refetch — including it would wipe in-progress edits
    // whenever react-query silently revalidates this query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurant?.id]);

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (!restaurant) throw new Error("Restoran pa jwenn");
      let logoUrl: string | null = null;
      let coverUrl: string | null = null;
      if (logo) logoUrl = await uploadAsset(restaurant.id, "logo", logo);
      if (cover) coverUrl = await uploadAsset(restaurant.id, "cover", cover);
      // The generator types these args as non-nullable because the SQL
      // params lack a `DEFAULT NULL` marker it recognizes — Postgres accepts
      // NULL for these columns regardless, so these casts just correct an
      // overly-strict generated type, no behavior change.
      const { error } = await supabase.rpc("update_restaurant_profile_secure", {
        _restaurant_id: restaurant.id,
        _name: f.name.trim(),
        _description: (f.description || null) as string,
        _cuisine: (f.cuisine || null) as string,
        _phone: (f.phone || null) as string,
        _address: (f.address || null) as string,
        _logo_url: logoUrl as string,
        _cover_url: coverUrl as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pwofil mizajou");
      setLogo(null);
      setCover(null);
      qc.invalidateQueries({ queryKey: ["me-restaurant-full"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const saveHours = useMutation({
    mutationFn: async () => {
      if (!restaurant) throw new Error("Restoran pa jwenn");
      const { error } = await supabase.rpc("update_restaurant_hours_secure", {
        _restaurant_id: restaurant.id,
        _opening_hours: hours,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Orè mizajou");
      qc.invalidateQueries({ queryKey: ["me-restaurant-full"] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="text-ink-soft">Chajman…</div>;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Pwofil restoran</h1>
          <p className="mt-1 text-ink-soft">Enfo piblik, logo, kouvèti ak orè ouvèti.</p>
        </div>
        <Link
          to="/dashboard/restaurant"
          className="text-sm font-bold text-brand-deep hover:underline"
        >
          ← Dashboard
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Enfòmasyon jeneral</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            placeholder="Non restoran"
            aria-label="Non restoran"
            className={inputCls()}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
          <input
            placeholder="Kategori (ex: Kreyòl, Fritay)"
            aria-label="Kategori (ex: Kreyòl, Fritay)"
            className={inputCls()}
            value={f.cuisine}
            onChange={(e) => setF({ ...f, cuisine: e.target.value })}
          />
          <input
            placeholder="Telefòn"
            aria-label="Telefòn"
            className={inputCls()}
            value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })}
          />
          <input
            placeholder="Adrès"
            aria-label="Adrès"
            className={inputCls()}
            value={f.address}
            onChange={(e) => setF({ ...f, address: e.target.value })}
          />
          <textarea
            placeholder="Deskripsyon"
            aria-label="Deskripsyon"
            rows={3}
            className={inputCls() + " sm:col-span-2"}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-brand-soft px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/20">
            <Upload className="h-3.5 w-3.5" /> {logo?.name || "Chanje logo"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-brand-soft px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/20">
            <Upload className="h-3.5 w-3.5" /> {cover?.name || "Chanje foto kouvèti"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setCover(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <button
          disabled={saveProfile.isPending}
          onClick={() => saveProfile.mutate()}
          className="mt-4 rounded-full bg-brand px-6 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
        >
          {saveProfile.isPending ? "Ap sove…" : "Sove pwofil la"}
        </button>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Orè ouvèti</h2>
        <div className="mt-3 space-y-2">
          {DAYS.map((d) => {
            const v = hours[d.key] ?? { open: "10:00", close: "22:00", closed: false };
            return (
              <div
                key={d.key}
                className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft/10 p-2"
              >
                <span className="w-24 text-sm font-bold">{d.label}</span>
                <label className="flex items-center gap-1 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    checked={!v.closed}
                    onChange={(e) =>
                      setHours((s) => ({ ...s, [d.key]: { ...v, closed: !e.target.checked } }))
                    }
                  />
                  Ouvè
                </label>
                {!v.closed && (
                  <>
                    <input
                      type="time"
                      value={v.open}
                      onChange={(e) =>
                        setHours((s) => ({ ...s, [d.key]: { ...v, open: e.target.value } }))
                      }
                      aria-label={`Lè ouvèti ${d.label}`}
                      className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
                    />
                    <span className="text-xs text-ink-soft">jiska</span>
                    <input
                      type="time"
                      value={v.close}
                      onChange={(e) =>
                        setHours((s) => ({ ...s, [d.key]: { ...v, close: e.target.value } }))
                      }
                      aria-label={`Lè fèmti ${d.label}`}
                      className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>
        <button
          disabled={saveHours.isPending}
          onClick={() => saveHours.mutate()}
          className="mt-4 rounded-full bg-brand px-6 py-2 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
        >
          {saveHours.isPending ? "Ap sove…" : "Sove orè yo"}
        </button>
      </section>
    </div>
  );
}

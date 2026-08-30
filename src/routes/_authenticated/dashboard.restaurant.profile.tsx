import { createFileRoute, Link } from "@tanstack/react-router";
import { requireRole } from "@/lib/auth-guard";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { Upload, X, Video } from "lucide-react";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { assertValidUploadFile } from "@/lib/file-validation";
import { Button } from "@/components/ui/button";
import { ActiveSessionsSection } from "@/components/active-sessions-section";
import { MyDevicesSection } from "@/components/my-devices-section";
import { HoursPicker, type WeeklyHours } from "@/components/hours-picker";
import { HOURS_DAYS } from "@/components/hours-picker.data";

// Owner-only: intentionally narrower than the parent layout's owner+staff
// guard — restaurant identity/settings shouldn't be editable by staff. Not
// redundant with the layout's guard, do not remove it.
export const Route = createFileRoute("/_authenticated/dashboard/restaurant/profile")({
  beforeLoad: ({ context }) => {
    requireRole(context.allRoles, ["restaurant_owner", "admin", "super_admin"]);
  },
  component: RestaurantProfile,
});

async function uploadAsset(restaurantId: string, kind: "logo" | "cover" | "team", file: File) {
  assertValidUploadFile(file, "restaurant-assets");
  const path = `${restaurantId}/${kind}-${Date.now()}-${file.name}`;
  const { error } = await supabase.storage
    .from("restaurant-assets")
    .upload(path, file, { upsert: false });
  if (error) throw error;
  return supabase.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl;
}

// Tach 8 Objektif B — bucket separe pou videyo (wè migrasyon 20260830090000
// pou poukisa: restaurant-assets se imaj-sèlman, 5MB, aplike nan motè
// Storage a).
async function uploadDishVideo(restaurantId: string, file: File) {
  assertValidUploadFile(file, "restaurant-videos");
  const path = `${restaurantId}/dish-video-${Date.now()}-${file.name}`;
  const { error } = await supabase.storage
    .from("restaurant-videos")
    .upload(path, file, { upsert: false });
  if (error) throw error;
  return supabase.storage.from("restaurant-videos").getPublicUrl(path).data.publicUrl;
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
  const [hours, setHours] = useState<WeeklyHours>({});
  // Tach 8 Objektif B — `teamPhotos` se sous verite kouran an (ranje ki
  // deja sove PLIS/MENN retire nan sesyon sa a); `newTeamPhotoFiles` se
  // fichye ki fèk chwazi, poko telechaje — telechajman reyèl la fèt
  // dedan `saveProfile` sèlman (menm moman ak logo/cover), pa imedyatman
  // lè yon fichye chwazi, pou pa kite yon fichye òfelen si itilizatè a
  // kite paj la san l pa sove.
  const [teamPhotos, setTeamPhotos] = useState<string[]>([]);
  const [newTeamPhotoFiles, setNewTeamPhotoFiles] = useState<File[]>([]);
  const [dishVideo, setDishVideo] = useState<File | null>(null);
  const [dishVideoUrl, setDishVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    setF({
      name: restaurant.name ?? "",
      description: restaurant.description ?? "",
      cuisine: restaurant.cuisine ?? "",
      phone: restaurant.phone ?? "",
      address: restaurant.address ?? "",
    });
    setTeamPhotos((restaurant.team_photos as string[] | null) ?? []);
    setDishVideoUrl(restaurant.dish_video_url ?? null);
    const h = (restaurant.opening_hours as WeeklyHours | null) ?? {};
    const next: WeeklyHours = {};
    for (const d of HOURS_DAYS) {
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
      const newPhotoUrls = await Promise.all(
        newTeamPhotoFiles.map((file) => uploadAsset(restaurant.id, "team", file)),
      );
      const finalTeamPhotos = [...teamPhotos, ...newPhotoUrls];
      let newDishVideoUrl: string | null = null;
      if (dishVideo) newDishVideoUrl = await uploadDishVideo(restaurant.id, dishVideo);
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
        _team_photos: finalTeamPhotos,
        _dish_video_url: newDishVideoUrl as string,
      });
      if (error) throw error;
      return { finalTeamPhotos };
    },
    onSuccess: ({ finalTeamPhotos }) => {
      toast.success("Pwofil mizajou");
      setLogo(null);
      setCover(null);
      setTeamPhotos(finalTeamPhotos);
      setNewTeamPhotoFiles([]);
      setDishVideo(null);
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

        {/* Tach 8 Objektif B — paj piblik restoran an (restaurants.$slug.tsx)
            montre sa yo nan yon seksyon "Sou nou" apre meni an. */}
        <div className="mt-5 border-t border-brand-soft/40 pt-4">
          <span className="mb-2 block text-xs font-bold uppercase text-ink-soft">
            Foto ekip la (paj piblik)
          </span>
          {(teamPhotos.length > 0 || newTeamPhotoFiles.length > 0) && (
            <div className="mb-2 flex flex-wrap gap-2">
              {teamPhotos.map((url, i) => (
                <div key={url} className="group relative">
                  <img
                    src={url}
                    alt={`Ekip ${i + 1}`}
                    width={72}
                    height={72}
                    className="h-[72px] w-[72px] rounded-xl border border-brand-soft/60 object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Retire foto sa a"
                    onClick={() => setTeamPhotos((prev) => prev.filter((u) => u !== url))}
                    className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {newTeamPhotoFiles.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex h-[72px] w-[72px] items-center justify-center rounded-xl border-2 border-dashed border-brand-soft/60 p-1 text-center text-[10px] text-ink-soft"
                >
                  {file.name}
                </div>
              ))}
            </div>
          )}
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-brand-soft px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/20">
            <Upload className="h-3.5 w-3.5" /> Ajoute foto ekip
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) setNewTeamPhotoFiles((prev) => [...prev, ...files]);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="mt-4 border-t border-brand-soft/40 pt-4">
          <span className="mb-2 block text-xs font-bold uppercase text-ink-soft">
            Videyo yon plat siyati (paj piblik)
          </span>
          {dishVideoUrl && !dishVideo && (
            <video
              src={dishVideoUrl}
              controls
              muted
              className="mb-2 max-h-40 rounded-xl border border-brand-soft/60"
            />
          )}
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-brand-soft px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/20">
            <Video className="h-3.5 w-3.5" />
            {dishVideo?.name || (dishVideoUrl ? "Chanje videyo a" : "Ajoute yon videyo")}
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => setDishVideo(e.target.files?.[0] ?? null)}
            />
          </label>
          <p className="mt-1 text-xs text-ink-soft">Maksimòm 50MB — mp4, webm, oswa mov.</p>
        </div>

        <Button
          className="mt-4"
          disabled={saveProfile.isPending}
          onClick={() => saveProfile.mutate()}
        >
          {saveProfile.isPending ? "Ap sove…" : "Sove pwofil la"}
        </Button>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="font-display text-lg font-bold">Orè ouvèti</h2>
        <div className="mt-3">
          <HoursPicker value={hours} onChange={setHours} />
        </div>
        <Button className="mt-4" disabled={saveHours.isPending} onClick={() => saveHours.mutate()}>
          {saveHours.isPending ? "Ap sove…" : "Sove orè yo"}
        </Button>
      </section>

      <MyDevicesSection />
      <ActiveSessionsSection />
    </div>
  );
}

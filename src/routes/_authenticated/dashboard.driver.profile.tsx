import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, User as UserIcon } from "lucide-react";
import { ChangePasswordForm } from "@/components/change-password-form";
import { inputCls } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard/driver/profile")({
  component: DriverProfile,
});

function DriverProfile() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["me-driver-profile", user?.id],
    queryFn: async () => {
      const [{ data: driver, error: e1 }, { data: profile, error: e2 }] = await Promise.all([
        supabase.from("drivers").select("*").eq("user_id", user!.id).maybeSingle(),
        supabase.from("profiles").select("avatar_url").eq("id", user!.id).maybeSingle(),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;
      return { driver, avatarUrl: profile?.avatar_url ?? null };
    },
  });

  const [f, setF] = useState({
    first_name: "", last_name: "", phone: "", address: "", vehicle_type: "", license_plate: "",
  });
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.driver) return;
    setF({
      first_name: data.driver.first_name ?? "",
      last_name: data.driver.last_name ?? "",
      phone: data.driver.phone ?? "",
      address: data.driver.address ?? "",
      vehicle_type: data.driver.vehicle_type ?? "",
      license_plate: data.driver.license_plate ?? "",
    });
  }, [data?.driver?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user || !data?.driver) throw new Error("Ou dwe konekte");
      let avatarUrl = data.avatarUrl;
      if (avatar) {
        const path = `${user.id}/avatar-${Date.now()}-${avatar.name}`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, avatar, { upsert: false });
        if (upErr) throw upErr;
        avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }
      const { error: e1 } = await supabase
        .from("drivers")
        .update({
          first_name: f.first_name || null,
          last_name: f.last_name || null,
          phone: f.phone || null,
          address: f.address || null,
          vehicle_type: f.vehicle_type || null,
          license_plate: f.license_plate || null,
        })
        .eq("user_id", user.id);
      if (e1) throw e1;
      if (avatar) {
        const { error: e2 } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("id", user.id);
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      toast.success("Pwofil mizajou");
      setAvatar(null);
      qc.invalidateQueries({ queryKey: ["me-driver-profile"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  function onPickAvatar(file: File | null) {
    setAvatar(file);
    if (file) setAvatarPreview(URL.createObjectURL(file));
  }

  const displayAvatar = avatarPreview ?? data?.avatarUrl ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Pwofil livrè</h1>
          <p className="mt-1 text-ink-soft">Modifye enfòmasyon w yo ak modpas ou.</p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">← Dashboard</Link>
      </div>

      {isLoading ? (
        <div className="text-ink-soft">Chajman…</div>
      ) : !data?.driver ? (
        <div className="text-ink-soft">Dosye livrè pa jwenn.</div>
      ) : (
        <>
          <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-4">
              <label className="group relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-brand-soft bg-brand-soft/30">
                {displayAvatar ? (
                  <img src={displayAvatar} alt="Avatar" width={80} height={80} className="h-full w-full object-cover" />
                ) : (
                  <UserIcon className="h-8 w-8 text-brand-deep" />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
                  <Upload className="h-5 w-5" />
                </span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)} />
              </label>
              <div className="text-sm">
                <div className="font-bold">{user?.email}</div>
                <div className="text-ink-soft">Klike sou foto a pou chanje avatar ou</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Prenon</span>
                <input className={inputCls()} value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Non</span>
                <input className={inputCls()} value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Telefòn</span>
                <input className={inputCls()} placeholder="+509 …" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Adrès</span>
                <input className={inputCls()} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Tip veyikil</span>
                <select className={inputCls()} value={f.vehicle_type} onChange={(e) => setF({ ...f, vehicle_type: e.target.value })}>
                  <option value="">—</option>
                  <option value="moto">Moto</option>
                  <option value="bicycle">Bekàn</option>
                  <option value="car">Machin</option>
                  <option value="scooter">Scooter</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Nimewo plak</span>
                <input className={inputCls()} value={f.license_plate} onChange={(e) => setF({ ...f, license_plate: e.target.value })} />
              </label>
            </div>

            <button
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="mt-4 rounded-full bg-brand px-6 py-2.5 font-display font-extrabold text-white hover:bg-brand-deep disabled:opacity-60"
            >
              {save.isPending ? "Ap sove…" : "Sove pwofil la"}
            </button>
          </section>

          <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-display text-lg font-bold text-ink">Chanje modpas</h2>
            <ChangePasswordForm />
          </section>
        </>
      )}
    </div>
  );
}

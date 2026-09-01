import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Upload, User as UserIcon, IdCard, AlertTriangle } from "lucide-react";
import { ChangePasswordForm } from "@/components/change-password-form";
import { ActiveSessionsSection } from "@/components/active-sessions-section";
import { MyDevicesSection } from "@/components/my-devices-section";
import { inputCls } from "@/lib/utils";
import { assertValidUploadFile } from "@/lib/file-validation";
import { Button } from "@/components/ui/button";

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
    first_name: "",
    last_name: "",
    phone: "",
    address: "",
    vehicle_type: "",
    license_plate: "",
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
    // `data.driver` is intentionally omitted: this seeds the editable form
    // once when the record first loads (keyed on id), not on every
    // background refetch — including it would wipe in-progress edits
    // whenever react-query silently revalidates this query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.driver?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user || !data?.driver) throw new Error("Ou dwe konekte");
      let avatarUrl = data.avatarUrl;
      if (avatar) {
        assertValidUploadFile(avatar, "avatars");
        const path = `${user.id}/avatar-${Date.now()}-${avatar.name}`;
        const { error: upErr } = await supabase.storage
          .from("avatars")
          .upload(path, avatar, { upsert: false });
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
        const { error: e2 } = await supabase
          .from("profiles")
          .update({ avatar_url: avatarUrl })
          .eq("id", user.id);
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

  // Catch-up path for docs/archive/audits/DRIVER_RESTAURANT_REGISTRATION_AUDIT.md § 9/13
  // (Root Cause R2/R3): the one-shot signup-time upload
  // (finalizeRegistrationDocuments) permanently locks out once the account
  // leaves `pending` or after 2h — there was previously *no* way, for
  // driver or admin, to attach a missing ID document afterward. This runs
  // with the driver's own real session (unlike the signup-time path, which
  // has none yet), so storage.objects.owner is set correctly by Storage
  // itself — no stampOwner() call needed here at all.
  const [idDoc, setIdDoc] = useState<File | null>(null);
  const uploadIdDoc = useMutation({
    mutationFn: async () => {
      if (!user || !idDoc) throw new Error("Chwazi yon fichye dabò");
      assertValidUploadFile(idDoc, "driver-documents");
      const path = `${user.id}/id-${Date.now()}-${idDoc.name}`;
      const { error: upErr } = await supabase.storage
        .from("driver-documents")
        .upload(path, idDoc, { upsert: false });
      if (upErr) throw upErr;
      // driver-documents is private — store the bare path, same convention
      // as the signup-time upload (register-documents.functions.ts); admin
      // reads it later via a signed URL (ProofThumb), never a public link.
      const { error: dbErr } = await supabase
        .from("drivers")
        .update({ id_doc_url: path })
        .eq("user_id", user.id);
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      toast.success("Pyès idantite ou anrejistre. Y ap tcheke l pou apwobasyon.");
      setIdDoc(null);
      qc.invalidateQueries({ queryKey: ["me-driver-profile"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  const displayAvatar = avatarPreview ?? data?.avatarUrl ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Pwofil livrè</h1>
          <p className="mt-1 text-ink-soft">Modifye enfòmasyon w yo ak modpas ou.</p>
        </div>
        <Link to="/dashboard/driver" className="text-sm font-bold text-brand-deep hover:underline">
          ← Dashboard
        </Link>
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
                  <img
                    src={displayAvatar}
                    alt="Avatar"
                    width={80}
                    height={80}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <UserIcon className="h-8 w-8 text-brand-deep" />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
                  <Upload className="h-5 w-5" />
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onPickAvatar(e.target.files?.[0] ?? null)}
                />
              </label>
              <div className="text-sm">
                <div className="font-bold">{user?.email}</div>
                <div className="text-ink-soft">Klike sou foto a pou chanje avatar ou</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Prenon</span>
                <input
                  className={inputCls()}
                  value={f.first_name}
                  onChange={(e) => setF({ ...f, first_name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Non</span>
                <input
                  className={inputCls()}
                  value={f.last_name}
                  onChange={(e) => setF({ ...f, last_name: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                  Telefòn
                </span>
                <input
                  className={inputCls()}
                  placeholder="+509 …"
                  value={f.phone}
                  onChange={(e) => setF({ ...f, phone: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Adrès</span>
                <input
                  className={inputCls()}
                  value={f.address}
                  onChange={(e) => setF({ ...f, address: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                  Tip veyikil
                </span>
                <select
                  className={inputCls()}
                  value={f.vehicle_type}
                  onChange={(e) => setF({ ...f, vehicle_type: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="moto">Moto</option>
                  <option value="bicycle">Bekàn</option>
                  <option value="car">Machin</option>
                  <option value="scooter">Scooter</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                  Nimewo plak
                </span>
                <input
                  className={inputCls()}
                  value={f.license_plate}
                  onChange={(e) => setF({ ...f, license_plate: e.target.value })}
                />
              </label>
            </div>

            <Button
              className="mt-4 font-display font-extrabold"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Ap sove…" : "Sove pwofil la"}
            </Button>
          </section>

          {!data.driver.id_doc_url && (
            <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5 shadow-sm">
              <h2 className="mb-1 flex items-center gap-1.5 font-display text-lg font-bold text-ink">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Pyès idantite manke
              </h2>
              <p className="mb-3 text-sm text-ink-soft">
                Nou pa jwenn okenn pyès idantite nan dosye w. San li, n ap ka apwouve/kenbe kont ou
                aktif. Chaje l kounye a.
              </p>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-amber-400 bg-white px-3 py-2.5 text-xs text-ink-soft hover:bg-amber-100/60">
                <IdCard className="h-3.5 w-3.5" /> {idDoc?.name || "Chwazi yon fichye (foto/PDF)"}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => setIdDoc(e.target.files?.[0] ?? null)}
                />
              </label>
              <Button
                className="mt-3"
                disabled={!idDoc || uploadIdDoc.isPending}
                onClick={() => uploadIdDoc.mutate()}
              >
                {uploadIdDoc.isPending ? "Ap voye…" : "Voye pyès idantite a"}
              </Button>
            </section>
          )}

          <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-display text-lg font-bold text-ink">Chanje modpas</h2>
            <ChangePasswordForm />
          </section>

          <MyDevicesSection />
          <ActiveSessionsSection />
        </>
      )}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Upload, User as UserIcon } from "lucide-react";
import { noIndexMeta } from "@/lib/seo";
import { inputCls } from "@/lib/utils";
import { AddressManager } from "@/components/address-manager";
import { ChangePasswordForm } from "@/components/change-password-form";
import { assertValidUploadFile } from "@/lib/file-validation";

export const Route = createFileRoute("/profile")({
  head: () => noIndexMeta("Pwofil mwen — NK Deliveri"),
  component: Profile,
});

function Profile() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["my-profile", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user!.id).single();
      if (error) throw error;
      return data;
    },
  });

  const [f, setF] = useState({ first_name: "", last_name: "", phone: "", address: "" });
  const [avatar, setAvatar] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setF({
      first_name: profile.first_name ?? "",
      last_name: profile.last_name ?? "",
      phone: profile.phone ?? "",
      address: profile.address ?? "",
    });
  }, [profile?.id]);

  const save = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Ou dwe konekte");
      let avatarUrl = profile?.avatar_url ?? null;
      if (avatar) {
        assertValidUploadFile(avatar, "avatars");
        const path = `${user.id}/avatar-${Date.now()}-${avatar.name}`;
        const { error: upErr } = await supabase.storage.from("avatars").upload(path, avatar, { upsert: false });
        if (upErr) throw upErr;
        avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      }
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: f.first_name || null,
          last_name: f.last_name || null,
          phone: f.phone || null,
          address: f.address || null,
          avatar_url: avatarUrl,
        })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Pwofil mizajou");
      setAvatar(null);
      qc.invalidateQueries({ queryKey: ["my-profile"] });
    },
    onError: (e) => toast.error(e.message ?? "Erè"),
  });

  function onPickAvatar(file: File | null) {
    setAvatar(file);
    if (file) setAvatarPreview(URL.createObjectURL(file));
  }

  const displayAvatar = avatarPreview ?? profile?.avatar_url ?? null;

  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader />
      <div className="mx-auto max-w-[640px] px-5 py-12">
        <h1 className="mb-3 font-display text-2xl font-extrabold">Pwofil</h1>
        <div className="rounded-[18px] bg-white p-6 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
          {!user ? (
            <div className="text-ink-soft">Konekte pou wè pwofil ou.</div>
          ) : isLoading ? (
            <div className="text-ink-soft">Chajman…</div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <label className="group relative flex h-20 w-20 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-brand-soft bg-brand-soft/30">
                  {displayAvatar ? (
                    <img src={displayAvatar} alt="Avatar" width={80} height={80} className="h-full w-full object-cover" />
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
                  <div className="font-bold">{user.email}</div>
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
                  <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Telefòn</span>
                  <input
                    className={inputCls()}
                    placeholder="+509 …"
                    value={f.phone}
                    onChange={(e) => setF({ ...f, phone: e.target.value })}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">Adrès</span>
                  <input
                    className={inputCls()}
                    placeholder="Kote w abite…"
                    value={f.address}
                    onChange={(e) => setF({ ...f, address: e.target.value })}
                  />
                </label>
              </div>

              <button
                disabled={save.isPending}
                onClick={() => save.mutate()}
                className="rounded-full bg-brand px-6 py-2.5 font-display font-extrabold text-white hover:bg-brand-deep disabled:opacity-60"
              >
                {save.isPending ? "Ap sove…" : "Sove pwofil la"}
              </button>
            </div>
          )}
        </div>

        {user && (
          <div className="mt-4 rounded-[18px] bg-white p-6 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
            <AddressManager userId={user.id} />
          </div>
        )}

        {user && (
          <div className="mt-4 rounded-[18px] bg-white p-6 shadow-[0_8px_24px_rgba(194,90,5,0.10)]">
            <h2 className="mb-3 font-display text-lg font-bold text-ink">Chanje modpas</h2>
            <ChangePasswordForm />
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

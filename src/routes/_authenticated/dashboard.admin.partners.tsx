import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, X, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { inputClsCompact as inputCls } from "@/lib/utils";
import { assertValidUploadFile } from "@/lib/file-validation";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";

type Partner = Database["public"]["Tables"]["partners"]["Row"];

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/partners")({
  component: AdminPartners,
});

async function uploadLogo(file: File) {
  assertValidUploadFile(file, "partner-logos");
  const path = `${Date.now()}-${file.name}`;
  const { error } = await supabase.storage.from("partner-logos").upload(path, file);
  if (error) throw error;
  return supabase.storage.from("partner-logos").getPublicUrl(path).data.publicUrl;
}

function AdminPartners() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  const partners = useQuery({
    queryKey: ["admin-partners"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_partners_admin");
      if (error) throw error;
      return data;
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (p: Partner) => {
      const { error } = await supabase.rpc("update_partner_secure", {
        _id: p.id,
        _name: p.name,
        _logo_url: p.logo_url,
        _link_url: p.link_url as string,
        _sort_order: p.sort_order,
        _is_active: !p.is_active,
      });
      if (error) throw error;
    },
    onSuccess: (_data, p) => {
      toast.success(p.is_active ? "Patnè dezaktive" : "Patnè aktive");
      qc.invalidateQueries({ queryKey: ["admin-partners"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("delete_partner_secure", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Patnè efase");
      qc.invalidateQueries({ queryKey: ["admin-partners"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Patnè Ofisyèl</h1>
          <p className="mt-1 text-ink-soft">
            Jere lojo ki parèt nan seksyon "Patnè Ofisyèl NK Deliveri" nan footer sit la. Seksyon an
            kache antyèman si pa gen okenn patnè aktif.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <Button
        onClick={() => {
          setEditing(null);
          setShowForm(true);
        }}
      >
        <Plus className="h-4 w-4" /> Nouvo patnè
      </Button>

      {showForm && (
        <PartnerForm
          partner={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-partners"] })}
        />
      )}

      <div className="space-y-3">
        {partners.data?.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <img
                src={p.logo_url}
                alt={p.name}
                width={48}
                height={48}
                className="h-12 w-12 rounded-xl border border-brand-soft/40 object-contain p-1"
              />
              <div>
                <div className="flex items-center gap-2 font-display font-bold text-ink">
                  {p.name}
                  <StatusBadge tone={p.is_active ? "good" : "neutral"}>
                    {p.is_active ? "Aktif" : "Dezaktive"}
                  </StatusBadge>
                </div>
                {p.link_url && <div className="text-xs text-ink-soft">{p.link_url}</div>}
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
                onClick={() =>
                  requestConfirm(`Efase patnè "${p.name}"?`, () => remove.mutate(p.id))
                }
                aria-label={`Efase patnè "${p.name}"`}
                className="rounded-lg border-2 border-red-200 px-2 py-1 text-red-700 transition hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        {partners.data?.length === 0 && (
          <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
            Poko gen okenn patnè.
          </div>
        )}
      </div>
      {ConfirmDialog}
    </div>
  );
}

function PartnerForm({
  partner,
  onClose,
  onSaved,
}: {
  partner: Partner | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(partner?.name ?? "");
  const [linkUrl, setLinkUrl] = useState(partner?.link_url ?? "");
  const [sortOrder, setSortOrder] = useState(String(partner?.sort_order ?? 0));
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) return toast.error("Non patnè a obligatwa");
    if (!partner && !logoFile) return toast.error("Logo a obligatwa");
    setSaving(true);
    try {
      const logoUrl = logoFile ? await uploadLogo(logoFile) : null;
      if (partner) {
        const { error } = await supabase.rpc("update_partner_secure", {
          _id: partner.id,
          _name: name.trim(),
          _logo_url: logoUrl ?? partner.logo_url,
          _link_url: (linkUrl || null) as string,
          _sort_order: Number(sortOrder) || 0,
          _is_active: partner.is_active,
        });
        if (error) throw error;
        toast.success("Patnè mizajou");
      } else {
        const { error } = await supabase.rpc("create_partner_secure", {
          _name: name.trim(),
          _logo_url: logoUrl!,
          _link_url: (linkUrl || null) as string,
          _sort_order: Number(sortOrder) || 0,
        });
        if (error) throw error;
        toast.success("Patnè kreye");
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erè pandan anrejistreman an");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">{partner ? "Modifye patnè" : "Nouvo patnè"}</h3>
        <button onClick={onClose} aria-label="Fèmen" className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          placeholder="Non patnè a"
          aria-label="Non patnè a"
          className={inputCls()}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Lyen sit patnè a (opsyonèl)"
          aria-label="Lyen sit patnè a"
          className={inputCls()}
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
            Priyorite (0 = premye)
          </span>
          <input
            type="number"
            className={inputCls()}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          />
        </label>
      </div>

      <div className="mt-3">
        {partner?.logo_url && !logoFile && (
          <img
            src={partner.logo_url}
            alt={partner.name}
            width={56}
            height={56}
            className="mb-2 h-14 w-14 rounded-xl border border-brand-soft/40 object-contain p-1"
          />
        )}
        <label className="flex w-fit cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed border-brand-soft px-3 py-2 text-xs text-ink-soft hover:bg-brand-soft/20">
          <Upload className="h-3.5 w-3.5" /> {logoFile?.name || "Chwazi/chanje logo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <p className="mt-1 text-xs text-ink-soft">Maksimòm 2MB — jpg, png, webp, oswa svg.</p>
      </div>

      <Button className="mt-4" disabled={saving} onClick={save}>
        {saving ? "Ap sove…" : "Sove patnè"}
      </Button>
    </div>
  );
}

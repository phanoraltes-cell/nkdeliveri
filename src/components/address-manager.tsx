import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MapPin, Plus, Pencil, Trash2, Star, X } from "lucide-react";
import { inputClsCompact as inputCls } from "@/lib/utils";

type Address = {
  id: string;
  label: string | null;
  address_line: string;
  city: string;
  notes: string | null;
  is_default: boolean;
};

/** Full CRUD for a customer's saved delivery addresses (public.addresses — RLS-scoped to auth.uid()). */
export function AddressManager({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);

  const addresses = useQuery({
    queryKey: ["my-addresses", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("addresses")
        .select("id, label, address_line, city, notes, is_default")
        .eq("user_id", userId)
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Address[];
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["my-addresses", userId] });
  }

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("addresses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Adrès efase");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const setDefault = useMutation({
    mutationFn: async (id: string) => {
      // No partial-unique-index enforcing "one default" at the DB level, so
      // this is two calls — unset the rest, then set the target — rather
      // than relying on a single atomic statement.
      const { error: e1 } = await supabase
        .from("addresses")
        .update({ is_default: false })
        .eq("user_id", userId)
        .neq("id", id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("addresses").update({ is_default: true }).eq("id", id);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("Adrès pa defo mizajou");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-ink">Adrès mwen yo</h2>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-brand-soft/60 px-3 text-xs font-bold text-brand-deep hover:bg-brand-soft"
        >
          <Plus className="h-3.5 w-3.5" /> Ajoute
        </button>
      </div>

      {addresses.isLoading && <div className="text-sm text-ink-soft">Chajman…</div>}
      {addresses.data?.length === 0 && !showForm && (
        <div className="rounded-xl border border-dashed border-brand-soft/60 p-4 text-center text-sm text-ink-soft">
          Ou poko gen okenn adrès anrejistre.
        </div>
      )}

      <div className="space-y-2">
        {addresses.data?.map((a) => (
          <div key={a.id} className="flex flex-wrap items-start gap-2 rounded-xl border border-brand-soft/50 p-3">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-deep" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 font-bold text-ink">
                {a.label || "Adrès"}
                {a.is_default && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                    Pa defo
                  </span>
                )}
              </div>
              <div className="text-xs text-ink-soft">
                {a.address_line}, {a.city}
              </div>
              {a.notes && <div className="text-xs text-ink-soft">{a.notes}</div>}
            </div>
            <div className="flex shrink-0 gap-1">
              {!a.is_default && (
                <button
                  onClick={() => setDefault.mutate(a.id)}
                  disabled={setDefault.isPending}
                  aria-label="Fè li pa defo"
                  title="Fè li pa defo"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-brand-soft/40 hover:text-brand-deep"
                >
                  <Star className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => {
                  setEditing(a);
                  setShowForm(true);
                }}
                aria-label="Modifye"
                title="Modifye"
                className="flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-brand-soft/40 hover:text-brand-deep"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => confirm(`Efase "${a.label || a.address_line}"?`) && remove.mutate(a.id)}
                aria-label="Efase"
                title="Efase"
                className="flex h-9 w-9 items-center justify-center rounded-full text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <AddressForm
          userId={userId}
          address={editing}
          makeFirstDefault={!addresses.data?.length}
          onClose={() => setShowForm(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}

function AddressForm({
  userId,
  address,
  makeFirstDefault,
  onClose,
  onSaved,
}: {
  userId: string;
  address: Address | null;
  makeFirstDefault: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    label: address?.label ?? "",
    address_line: address?.address_line ?? "",
    city: address?.city ?? "Gonaïves",
    notes: address?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.address_line.trim()) return toast.error("Antre yon adrès");
    setSaving(true);
    try {
      if (address) {
        const { error } = await supabase
          .from("addresses")
          .update({
            label: f.label || null,
            address_line: f.address_line.trim(),
            city: f.city.trim() || "Gonaïves",
            notes: f.notes || null,
          })
          .eq("id", address.id);
        if (error) throw error;
        toast.success("Adrès mizajou");
      } else {
        const { error } = await supabase.from("addresses").insert({
          user_id: userId,
          label: f.label || null,
          address_line: f.address_line.trim(),
          city: f.city.trim() || "Gonaïves",
          notes: f.notes || null,
          is_default: makeFirstDefault,
        });
        if (error) throw error;
        toast.success("Adrès ajoute");
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
    <div className="mt-3 rounded-2xl border-2 border-brand-soft bg-brand-soft/10 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display font-bold">{address ? "Modifye adrès" : "Nouvo adrès"}</h3>
        <button onClick={onClose} className="text-ink-soft hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          placeholder="Non (ex: Lakay, Travay)"
          className={inputCls()}
          value={f.label}
          onChange={(e) => setF({ ...f, label: e.target.value })}
        />
        <input
          placeholder="Vil"
          className={inputCls()}
          value={f.city}
          onChange={(e) => setF({ ...f, city: e.target.value })}
        />
        <input
          placeholder="Adrès konplè"
          className={inputCls() + " sm:col-span-2"}
          value={f.address_line}
          onChange={(e) => setF({ ...f, address_line: e.target.value })}
        />
        <input
          placeholder="Nòt pou livrè a (opsyonèl)"
          className={inputCls() + " sm:col-span-2"}
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
        />
      </div>
      <button
        disabled={saving}
        onClick={save}
        className="mt-4 rounded-full bg-brand px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-deep disabled:opacity-50"
      >
        {saving ? "Ap sove…" : "Sove adrès"}
      </button>
    </div>
  );
}

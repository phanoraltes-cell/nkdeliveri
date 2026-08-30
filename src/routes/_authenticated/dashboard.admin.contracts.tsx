import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FileSignature, ShieldOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/contracts")({
  component: AdminContracts,
});

function AdminContracts() {
  const qc = useQueryClient();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [newContent, setNewContent] = useState("");

  const versions = useQuery({
    queryKey: ["admin-contract-versions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurant_contract_versions")
        .select("*")
        .order("version", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const currentVersion = versions.data?.[0];

  // Restoran ki nan etap siyati a (apwouve pa admin, ap tann pwopriyetè a
  // siyen) — pi enpòtan pou admin wè, san aksyon disponib pou li (li
  // pa ka siyen pou non pwopriyetè a).
  const pendingSignature = useQuery({
    queryKey: ["admin-restaurants-pending-contract"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, updated_at")
        .eq("status", "pending_contract")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Restoran ki gen yon siyati AKTIF (revoked_at IS NULL) — sèl kandida
  // valid pou revoke_restaurant_contract_secure.
  const signedRestaurants = useQuery({
    queryKey: ["admin-restaurants-signed-contract"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("restaurant_contract_signatures")
        .select("id, restaurant_id, signature_name, signed_at, restaurants(name)")
        .is("revoked_at", null)
        .order("signed_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const publish = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.rpc("create_contract_version_secure", {
        _content: content,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nouvo vèsyon kontra pibliye");
      setNewContent("");
      qc.invalidateQueries({ queryKey: ["admin-contract-versions"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async ({ restaurantId, reason }: { restaurantId: string; reason: string }) => {
      const { error } = await supabase.rpc("revoke_restaurant_contract_secure", {
        _restaurant_id: restaurantId,
        _reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Siyati revoke — restoran an rekoumanse tann yon nouvo siyati");
      qc.invalidateQueries({ queryKey: ["admin-restaurants-signed-contract"] });
      qc.invalidateQueries({ queryKey: ["admin-restaurants-pending-contract"] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Kontra Restoran</h1>
          <p className="mt-1 text-ink-soft">Jere tèks kontra platfòm lan ak siyati restoran yo.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-1 font-display text-lg font-bold text-ink">Vèsyon aktyèl la</h2>
        {currentVersion ? (
          <>
            <p className="mb-2 text-xs text-ink-soft">
              Vèsyon {currentVersion.version} — pibliye{" "}
              {new Date(currentVersion.created_at).toLocaleDateString("fr-HT")}
            </p>
            <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-brand-soft/40 bg-cream p-3 text-sm text-ink">
              {currentVersion.content}
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-soft">
            Poko gen okenn kontra pibliye — restoran yo p ap ka pase etap siyati a jiskaske w
            pibliye yon premye vèsyon anba a.
          </p>
        )}

        <h3 className="mt-4 mb-1 text-sm font-bold text-ink">
          Pibliye yon {currentVersion ? "nouvo vèsyon" : "premye vèsyon"}
        </h3>
        <p className="mb-2 text-xs text-ink-soft">
          Yon nouvo vèsyon pa afekte restoran ki siyen deja — yo rete gate sou vèsyon yo te siyen
          an. Sèl nouvo siyati yo (oswa yon restoran ki revoke) itilize dènye vèsyon an.
        </p>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="Tape tèks konplè kontra a…"
          rows={8}
          className="w-full resize-y rounded-xl border-2 border-brand-soft bg-white px-3 py-2 text-sm focus:border-brand focus:outline-none"
        />
        <Button
          className="mt-2"
          disabled={!newContent.trim() || publish.isPending}
          isLoading={publish.isPending}
          onClick={() => publish.mutate(newContent.trim())}
        >
          <FileSignature className="h-4 w-4" /> Pibliye vèsyon{" "}
          {currentVersion ? currentVersion.version + 1 : 1}
        </Button>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Ap tann siyati ({pendingSignature.data?.length ?? 0})
        </h2>
        {pendingSignature.data?.length === 0 && (
          <div className="text-sm text-ink-soft">Pa gen okenn restoran k ap tann siyen.</div>
        )}
        <div className="space-y-2">
          {pendingSignature.data?.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between rounded-xl border border-brand-soft/40 px-3 py-2 text-sm"
            >
              <span className="font-semibold text-ink">{r.name}</span>
              <StatusBadge tone="warn">Ap tann siyati</StatusBadge>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
        <h2 className="mb-3 font-display text-lg font-bold text-ink">
          Kontra siyen aktivman ({signedRestaurants.data?.length ?? 0})
        </h2>
        {signedRestaurants.data?.length === 0 && (
          <div className="text-sm text-ink-soft">Pa gen okenn siyati aktif.</div>
        )}
        <div className="space-y-2">
          {signedRestaurants.data?.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-soft/40 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-semibold text-ink">{s.restaurants?.name ?? "—"}</div>
                <div className="text-xs text-ink-soft">
                  Siyen pa {s.signature_name} — {new Date(s.signed_at).toLocaleDateString("fr-HT")}
                </div>
              </div>
              <button
                onClick={() =>
                  requestConfirm(
                    `Revoke kontra "${s.restaurants?.name}"? Restoran an ap fèmen imedyatman epi retounen nan etap siyati.`,
                    () => {
                      const reason = window.prompt("Rezon revoke a (opsyonèl):") ?? "";
                      revoke.mutate({ restaurantId: s.restaurant_id, reason });
                    },
                  )
                }
                className="inline-flex items-center gap-1 rounded-full border-2 border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
              >
                <ShieldOff className="h-3.5 w-3.5" /> Revoke
              </button>
            </div>
          ))}
        </div>
      </section>
      {ConfirmDialog}
    </div>
  );
}

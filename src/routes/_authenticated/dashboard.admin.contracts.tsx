import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { FileSignature, ShieldOff, Store, Bike } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

type ContractType = "restaurant" | "driver";

// Role guard lives on the parent layout (dashboard.admin.tsx) — this used to
// repeat the same check locally, which was redundant with it.
export const Route = createFileRoute("/_authenticated/dashboard/admin/contracts")({
  component: AdminContracts,
});

function AdminContracts() {
  const [type, setType] = useState<ContractType>("restaurant");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Kontra</h1>
          <p className="mt-1 text-ink-soft">
            De tip kontra separe — youn pou restoran, youn pou livrè.
          </p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex gap-2">
        <Chip selected={type === "restaurant"} onClick={() => setType("restaurant")}>
          <Store className="h-3.5 w-3.5" /> Kontra Restoran
        </Chip>
        <Chip selected={type === "driver"} onClick={() => setType("driver")}>
          <Bike className="h-3.5 w-3.5" /> Kontra Livrè
        </Chip>
      </div>

      <ContractTypePanel type={type} />
    </div>
  );
}

function ContractTypePanel({ type }: { type: ContractType }) {
  const qc = useQueryClient();
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();
  const [newContent, setNewContent] = useState("");
  const noun = type === "restaurant" ? "restoran" : "livrè";

  const versions = useQuery({
    queryKey: ["admin-contract-versions", type],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_versions")
        .select("*")
        .eq("contract_type", type)
        .order("version", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const currentVersion = versions.data?.[0];

  // Kandida ki nan etap siyati a — kolòn/tab DIFERAN selon tip la
  // (restaurants.status vs drivers.account_status, de dimansyon SEPARE
  // ki egziste pou de rezon diferan, wè migrasyon 20260830130000).
  const pendingSignature = useQuery({
    queryKey: ["admin-pending-contract", type],
    queryFn: async () => {
      if (type === "restaurant") {
        const { data, error } = await supabase
          .from("restaurants")
          .select("id, name, updated_at")
          .eq("status", "pending_contract")
          .order("updated_at", { ascending: false });
        if (error) throw error;
        return data.map((r) => ({ id: r.id, name: r.name, updated_at: r.updated_at }));
      }
      const { data, error } = await supabase
        .from("drivers")
        .select("id, first_name, last_name, updated_at")
        .eq("account_status", "pending_contract")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data.map((d) => ({
        id: d.id,
        name: [d.first_name, d.last_name].filter(Boolean).join(" ") || "Livrè san non",
        updated_at: d.updated_at,
      }));
    },
  });

  const signedList = useQuery({
    queryKey: ["admin-signed-contract", type],
    queryFn: async () => {
      if (type === "restaurant") {
        const { data, error } = await supabase
          .from("contract_signatures")
          .select("id, restaurant_id, signature_name, signed_at, restaurants(name)")
          .not("restaurant_id", "is", null)
          .is("revoked_at", null)
          .order("signed_at", { ascending: false });
        if (error) throw error;
        return data.map((s) => ({
          id: s.id,
          targetId: s.restaurant_id!,
          name: s.restaurants?.name ?? "—",
          signature_name: s.signature_name,
          signed_at: s.signed_at,
        }));
      }
      const { data, error } = await supabase
        .from("contract_signatures")
        .select("id, driver_id, signature_name, signed_at, drivers(first_name, last_name)")
        .not("driver_id", "is", null)
        .is("revoked_at", null)
        .order("signed_at", { ascending: false });
      if (error) throw error;
      return data.map((s) => ({
        id: s.id,
        targetId: s.driver_id!,
        name:
          [s.drivers?.first_name, s.drivers?.last_name].filter(Boolean).join(" ") ||
          "Livrè san non",
        signature_name: s.signature_name,
        signed_at: s.signed_at,
      }));
    },
  });

  const publish = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await supabase.rpc("create_contract_version_secure", {
        _content: content,
        _contract_type: type,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nouvo vèsyon kontra pibliye");
      setNewContent("");
      qc.invalidateQueries({ queryKey: ["admin-contract-versions", type] });
    },
    onError: (e) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async ({ targetId, reason }: { targetId: string; reason: string }) => {
      const rpc =
        type === "restaurant"
          ? "revoke_restaurant_contract_secure"
          : "revoke_driver_contract_secure";
      const args =
        type === "restaurant"
          ? { _restaurant_id: targetId, _reason: reason }
          : { _driver_id: targetId, _reason: reason };
      const { error } = await supabase.rpc(rpc, args);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Siyati revoke — " + noun + " a rekoumanse tann yon nouvo siyati");
      qc.invalidateQueries({ queryKey: ["admin-signed-contract", type] });
      qc.invalidateQueries({ queryKey: ["admin-pending-contract", type] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
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
            Poko gen okenn kontra {noun} pibliye — {noun} yo p ap ka pase etap siyati a jiskaske w
            pibliye yon premye vèsyon anba a.
          </p>
        )}

        <h3 className="mt-4 mb-1 text-sm font-bold text-ink">
          Pibliye yon {currentVersion ? "nouvo vèsyon" : "premye vèsyon"}
        </h3>
        <p className="mb-2 text-xs text-ink-soft">
          Yon nouvo vèsyon pa afekte {noun} ki siyen deja — yo rete gate sou vèsyon yo te siyen an.
          Sèl nouvo siyati yo (oswa yon {noun} ki revoke) itilize dènye vèsyon an.
        </p>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder={`Tape tèks konplè kontra ${noun} a…`}
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
          <div className="text-sm text-ink-soft">Pa gen okenn {noun} k ap tann siyen.</div>
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
          Kontra siyen aktivman ({signedList.data?.length ?? 0})
        </h2>
        {signedList.data?.length === 0 && (
          <div className="text-sm text-ink-soft">Pa gen okenn siyati aktif.</div>
        )}
        <div className="space-y-2">
          {signedList.data?.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-soft/40 px-3 py-2 text-sm"
            >
              <div>
                <div className="font-semibold text-ink">{s.name}</div>
                <div className="text-xs text-ink-soft">
                  Siyen pa {s.signature_name} — {new Date(s.signed_at).toLocaleDateString("fr-HT")}
                </div>
              </div>
              <button
                onClick={() =>
                  requestConfirm(
                    `Revoke kontra "${s.name}"? ${noun[0].toUpperCase() + noun.slice(1)} an ap fèmen imedyatman epi retounen nan etap siyati.`,
                    () => {
                      const reason = window.prompt("Rezon revoke a (opsyonèl):") ?? "";
                      revoke.mutate({ targetId: s.targetId, reason });
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

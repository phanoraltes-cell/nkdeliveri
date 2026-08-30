import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { inputCls } from "@/lib/utils";

/**
 * Ekstansyon Tach 7 (demand itilizatè: de tip kontra — restoran + livrè).
 * Pandan drivers.account_status = 'pending_contract' (mete pa admin via
 * approve_driver_pending_contract_secure apre aplikasyon an apwouve),
 * livrè a li epi siyen dènye vèsyon kontra LIVRÈ a (kontra_type='driver',
 * separe antyèman de kontra restoran an). Se SÈL RPC ki fè account_status
 * pase 'pending_contract' → 'active' (sign_driver_contract_secure) — pa
 * gen okenn lòt chemen, menm pou admin. `status` (pending/approved/
 * online/offline) rete SAN TOUCHE — se yon dimansyon totalman separe.
 */
export function DriverContractSigningCard({
  driverId,
  userId,
}: {
  driverId: string;
  userId: string;
}) {
  const qc = useQueryClient();
  const [signatureName, setSignatureName] = useState("");
  const [agreed, setAgreed] = useState(false);

  const contract = useQuery({
    queryKey: ["current-driver-contract"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_current_contract_secure", {
        _contract_type: "driver",
      });
      if (error) throw error;
      return Array.isArray(data) ? (data[0] ?? null) : data;
    },
  });

  const sign = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("sign_driver_contract_secure", {
        _driver_id: driverId,
        _signature_name: signatureName.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Kontra a siyen — kont ou aktif kounye a!");
      qc.invalidateQueries({ queryKey: ["me-driver", userId] });
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-2xl rounded-2xl border-2 border-brand-soft bg-white p-6 shadow-brand-sm">
      <div className="flex items-center gap-2 font-display text-xl font-extrabold text-ink">
        <FileSignature className="h-5 w-5 text-brand-deep" aria-hidden="true" /> Siyen kontra livrè
        a
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Aplikasyon ou apwouve! Dènye etap la se li epi siyen kontra platfòm lan pou aktive kont ou —
        ou p ap ka mete tèt ou anliy oswa aksepte livrezon jiskaske w siyen.
      </p>

      {contract.isLoading ? (
        <Skeleton className="mt-4 h-40 w-full rounded-xl" />
      ) : contract.data ? (
        <>
          <div className="mt-4 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-xl border border-brand-soft/60 bg-cream p-4 text-sm text-ink">
            {contract.data.content}
          </div>
          <p className="mt-1.5 text-xs text-ink-soft">Vèsyon {contract.data.version}</p>

          <label className="mt-4 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
            />
            Mwen li epi mwen dakò ak tèm kontra sa a.
          </label>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-bold uppercase text-ink-soft">
              Non konplè ou (siyati)
            </span>
            <input
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="Tape non konplè ou pou siyen"
              className={inputCls()}
            />
          </label>

          <Button
            className="mt-4 w-full"
            disabled={!agreed || !signatureName.trim() || sign.isPending}
            isLoading={sign.isPending}
            onClick={() => sign.mutate()}
          >
            Siyen epi aktive kont mwen
          </Button>
        </>
      ) : (
        <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Kontra a poko disponib pou kounye a — tanpri tann, oswa kontakte sipò.
        </div>
      )}
    </div>
  );
}

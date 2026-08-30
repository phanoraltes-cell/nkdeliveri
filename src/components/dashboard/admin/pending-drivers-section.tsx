import { CheckCircle2, XCircle } from "lucide-react";
import { ProofThumb } from "@/components/proof-thumb";
import { Button } from "@/components/ui/button";

export type PendingDriver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  vehicle_type: string | null;
  license_plate: string | null;
  id_doc_url: string | null;
  license_doc_url: string | null;
  vehicle_photo_url: string | null;
  created_at: string;
};

type PendingDriversSectionProps = {
  drivers: PendingDriver[] | undefined;
  isLoading: boolean;
  /** id of the driver currently being approved/rejected, if any — only that row's buttons disable, other rows stay actionable. */
  pendingId?: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
};

/** Admin dashboard's driver-approval queue, with ID/license/vehicle document previews and an approve/reject action pair. */
export function PendingDriversSection({
  drivers,
  isLoading,
  pendingId,
  onApprove,
  onReject,
}: PendingDriversSectionProps) {
  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-display text-xl font-bold text-ink">Livrè an atant valdasyon</h2>
      <p className="mb-4 text-xs text-ink-soft">
        "Apwouve" voye livrè a nan etap siyati kontra — kont li vin aktif sèlman apre li siyen.
      </p>
      {isLoading && <div className="text-ink-soft">Chajman...</div>}
      {drivers?.length === 0 && (
        <div className="text-sm text-ink-soft">Pa gen okenn livrè an atant.</div>
      )}
      <div className="space-y-3">
        {drivers?.map((d) => (
          <div key={d.id} className="rounded-xl border border-brand-soft/50 p-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex flex-wrap gap-2">
                {d.id_doc_url ? (
                  <ProofThumb
                    path={d.id_doc_url}
                    bucket="driver-documents"
                    alt={`Pyès idantite ${d.first_name}`}
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50 text-center text-[10px] font-semibold text-red-700">
                    Pa gen pyès idantite!
                  </div>
                )}
                {d.license_doc_url && (
                  <ProofThumb
                    path={d.license_doc_url}
                    bucket="driver-documents"
                    alt={`Pèmi ${d.first_name}`}
                  />
                )}
                {d.vehicle_photo_url && (
                  <ProofThumb
                    path={d.vehicle_photo_url}
                    bucket="driver-documents"
                    alt={`Veyikil ${d.first_name}`}
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">
                  {d.first_name} {d.last_name}
                </div>
                <div className="text-xs text-ink-soft">
                  {d.vehicle_type || "—"} · {d.license_plate || "san plak"} ·{" "}
                  {d.phone || "san telefòn"}
                </div>
                <div className="text-xs text-ink-soft">{d.address || "san adrès"}</div>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={pendingId === d.id}
                onClick={() => onApprove(d.id)}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {pendingId === d.id ? "Ap trete…" : "Apwouve"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pendingId === d.id}
                onClick={() => onReject(d.id)}
              >
                <XCircle className="h-3.5 w-3.5" />
                {pendingId === d.id ? "Ap trete…" : "Refize"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

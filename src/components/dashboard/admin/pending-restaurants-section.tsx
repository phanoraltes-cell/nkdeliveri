import { CheckCircle2, XCircle } from "lucide-react";
import { ProofThumb } from "@/components/proof-thumb";
import { Button } from "@/components/ui/button";

export type PendingRestaurant = {
  id: string;
  name: string;
  cuisine: string | null;
  phone: string | null;
  address: string | null;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  created_at: string;
};

type PendingRestaurantsSectionProps = {
  restaurants: PendingRestaurant[] | undefined;
  isLoading: boolean;
  /** id of the restaurant currently being approved/rejected, if any — only that row's buttons disable, other rows stay actionable. */
  pendingId?: string;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
};

/** Admin dashboard's restaurant-approval queue, with logo/cover previews and an approve/reject action pair. */
export function PendingRestaurantsSection({
  restaurants,
  isLoading,
  pendingId,
  onApprove,
  onReject,
}: PendingRestaurantsSectionProps) {
  return (
    <section className="rounded-2xl border border-brand-soft/60 bg-white p-5 shadow-sm">
      <h2 className="mb-1 font-display text-xl font-bold text-ink">Restoran an atant valdasyon</h2>
      <p className="mb-4 text-xs text-ink-soft">
        "Apwouve" voye restoran an nan etap siyati kontra — li vin aktif sèlman apre pwopriyetè a
        siyen.
      </p>
      {isLoading && <div className="text-ink-soft">Chajman...</div>}
      {restaurants?.length === 0 && (
        <div className="text-sm text-ink-soft">Pa gen okenn restoran an atant.</div>
      )}
      <div className="space-y-3">
        {restaurants?.map((r) => (
          <div key={r.id} className="rounded-xl border border-brand-soft/50 p-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex gap-2">
                {r.logo_url ? (
                  <ProofThumb path={r.logo_url} alt={`Logo ${r.name}`} />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-brand-soft/60 text-[10px] text-ink-soft">
                    San logo
                  </div>
                )}
                {r.cover_url ? (
                  <ProofThumb path={r.cover_url} alt={`Kouvèti ${r.name}`} />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-brand-soft/60 text-[10px] text-ink-soft">
                    San kouvèti
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-ink">{r.name}</div>
                <div className="text-xs text-ink-soft">
                  {r.cuisine || "—"} · {r.phone || "san telefòn"} · {r.address || "san adrès"}
                </div>
                {r.description && <p className="mt-1 text-xs text-ink-soft">{r.description}</p>}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                disabled={pendingId === r.id}
                onClick={() => onApprove(r.id)}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {pendingId === r.id ? "Ap trete…" : "Apwouve"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={pendingId === r.id}
                onClick={() => onReject(r.id)}
              >
                <XCircle className="h-3.5 w-3.5" />
                {pendingId === r.id ? "Ap trete…" : "Refize"}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

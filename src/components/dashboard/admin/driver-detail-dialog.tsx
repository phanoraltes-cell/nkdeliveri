import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { formatHTG } from "@/lib/format";
import { Star, Bike, CheckCircle2, XCircle, Wallet, Clock } from "lucide-react";

export type DriverAdminDetail = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string;
  status: string;
  created_at: string;
  vehicle_type: string | null;
  license_plate: string | null;
  moncash_number: string | null;
  natcash_number: string | null;
  total_deliveries: number;
  delivered_count: number;
  cancelled_count: number;
  success_rate: number | null;
  avg_delivery_minutes: number | null;
  avg_rating: number | null;
  available_balance: number;
  last_payment_date: string | null;
};

const DRIVER_STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  approved: "Apwouve",
  suspended: "Sispann",
  rejected: "Rejte",
  online: "An liy",
  offline: "Òfliy",
};
const DRIVER_STATUS_TONE: Record<string, "good" | "warn" | "bad" | "neutral" | "info"> = {
  pending: "warn",
  approved: "good",
  suspended: "bad",
  rejected: "bad",
  online: "good",
  offline: "neutral",
};

type DriverDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driver: DriverAdminDetail | null;
  onStatusChange: (
    id: string,
    status: "approved" | "rejected" | "suspended",
    reason?: string,
  ) => void;
  isPending: boolean;
};

/**
 * Full driver profile — general/financial/operational/payout info in one
 * dialog, per Phase 1 of the admin evolution plan. All data is already
 * returned by get_drivers_admin (the row the admin clicked), so opening
 * this never triggers an extra network round-trip — same principle
 * BeneficiaryDetailDialog already uses for financial data.
 */
export function DriverDetailDialog({
  open,
  onOpenChange,
  driver,
  onStatusChange,
  isPending,
}: DriverDetailDialogProps) {
  const [reasonAction, setReasonAction] = useState<"rejected" | "suspended" | null>(null);
  const [reason, setReason] = useState("");

  if (!driver) return null;

  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ") || "—";

  function closeReasonPrompt() {
    setReasonAction(null);
    setReason("");
  }

  function confirmReasonAction() {
    if (!reasonAction || !driver) return;
    onStatusChange(driver.id, reasonAction, reason);
    closeReasonPrompt();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeReasonPrompt();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {name}
            <StatusBadge tone={DRIVER_STATUS_TONE[driver.status] ?? "neutral"}>
              {DRIVER_STATUS_LABEL[driver.status] ?? driver.status}
            </StatusBadge>
          </DialogTitle>
          <DialogDescription>
            Enskri {new Date(driver.created_at).toLocaleDateString("fr-HT")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section>
            <h3 className="mb-2 text-xs font-bold uppercase text-ink-soft">Enfòmasyon jeneral</h3>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <span className="text-ink-soft">Telefòn : </span>
                {driver.phone ? (
                  <a href={`tel:${driver.phone}`} className="font-bold text-brand-deep">
                    {driver.phone}
                  </a>
                ) : (
                  "—"
                )}
              </div>
              <div>
                <span className="text-ink-soft">Imèl : </span>
                <span className="font-medium">{driver.email}</span>
              </div>
              <div>
                <span className="text-ink-soft">Machin : </span>
                <span className="font-medium">{driver.vehicle_type ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink-soft">Plak : </span>
                <span className="font-medium">{driver.license_plate ?? "—"}</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase text-ink-soft">Finans</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <KpiCard
                label="Balans disponib"
                value={formatHTG(driver.available_balance)}
                icon={Wallet}
              />
              <KpiCard
                label="Dènye peman"
                value={
                  driver.last_payment_date
                    ? new Date(driver.last_payment_date).toLocaleDateString("fr-HT")
                    : "Poko gen"
                }
                icon={Clock}
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <span className="text-ink-soft">Nimewo MonCash : </span>
                <span className="font-medium">{driver.moncash_number ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink-soft">Nimewo NatCash : </span>
                <span className="font-medium">{driver.natcash_number ?? "—"}</span>
              </div>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-bold uppercase text-ink-soft">Operasyon</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard label="Livrezon total" value={String(driver.total_deliveries)} icon={Bike} />
              <KpiCard
                label="Tux reyisit"
                value={
                  driver.success_rate != null ? `${Math.round(driver.success_rate * 100)}%` : "—"
                }
                icon={CheckCircle2}
              />
              <KpiCard label="Anile" value={String(driver.cancelled_count)} icon={XCircle} />
              <KpiCard
                label="Tan mwayèn livrezon"
                value={
                  driver.avg_delivery_minutes != null
                    ? `${Math.round(driver.avg_delivery_minutes)} min`
                    : "—"
                }
                icon={Clock}
              />
              <KpiCard
                label="Nòt mwayèn"
                value={driver.avg_rating != null ? driver.avg_rating.toFixed(1) : "—"}
                icon={Star}
              />
            </div>
          </section>

          <section className="border-t border-brand-soft/40 pt-4">
            {reasonAction ? (
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase text-ink-soft">
                  Rezon ({reasonAction === "rejected" ? "rejè" : "sispansyon"})
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border-2 border-brand-soft bg-white px-3 py-2 text-sm outline-none focus:border-brand"
                  placeholder="Eksplike poukisa (opsyonèl)…"
                />
                <div className="flex gap-2">
                  <Button variant="outline" onClick={closeReasonPrompt} disabled={isPending}>
                    Anile
                  </Button>
                  <Button variant="destructive" onClick={confirmReasonAction} disabled={isPending}>
                    {isPending ? "Ap sove…" : "Konfime"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {driver.status === "pending" && (
                  <>
                    <Button
                      disabled={isPending}
                      onClick={() => onStatusChange(driver.id, "approved")}
                    >
                      Apwouve
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={isPending}
                      onClick={() => setReasonAction("rejected")}
                    >
                      Rejte
                    </Button>
                  </>
                )}
                {driver.status === "approved" && (
                  <Button
                    variant="destructive"
                    disabled={isPending}
                    onClick={() => setReasonAction("suspended")}
                  >
                    Sispann
                  </Button>
                )}
                {driver.status === "suspended" && (
                  <Button
                    disabled={isPending}
                    onClick={() => onStatusChange(driver.id, "approved")}
                  >
                    Reyaktive
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

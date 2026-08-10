import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { KpiCard } from "@/components/dashboard/cards/kpi-card";
import { CommissionHistoryTable } from "@/components/dashboard/commission/commission-history-table";
import { PayoutHistoryTable } from "@/components/dashboard/payouts/payout-history-table";
import { ProofThumb } from "@/components/proof-thumb";
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
  id_doc_url: string | null;
  license_doc_url: string | null;
  vehicle_photo_url: string | null;
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
 * Full driver profile — mini CRM (Phase 2): "Apèsi" tab keeps the
 * general/financial-summary/operational info from Phase 1 (all already
 * returned by get_drivers_admin, no extra round-trip), "Istwa Finansye"
 * adds the actual commission/payout history — reusing
 * CommissionHistoryTable/PayoutHistoryTable verbatim, the same
 * components the restaurant/driver "Mes Komisyon"/"Mes Peman" pages and
 * BeneficiaryDetailDialog already use. No new history-fetching logic
 * anywhere — one source of truth for what a driver is owed/has been paid.
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
  // Mirror only — the real, authoritative gate is in update_driver_status_secure
  // (docs/DRIVER_RESTAURANT_REGISTRATION_REMEDIATION_REPORT.md); this just
  // avoids a round-trip error for the common case instead of being the only
  // guard (a direct RPC call bypassing this dialog is still blocked server-side).
  const hasIdDoc = Boolean(driver.id_doc_url);

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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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

        <Tabs defaultValue="apesi">
          <TabsList>
            <TabsTrigger value="apesi">Apèsi</TabsTrigger>
            <TabsTrigger value="finans">Istwa Finansye</TabsTrigger>
          </TabsList>

          <TabsContent value="apesi" className="space-y-5">
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase text-ink-soft">Dokiman</h3>
              <div className="flex flex-wrap gap-2">
                {driver.id_doc_url ? (
                  <ProofThumb
                    path={driver.id_doc_url}
                    bucket="driver-documents"
                    alt={`Pyès idantite ${name}`}
                  />
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-red-300 bg-red-50 text-center text-[10px] font-semibold text-red-700">
                    Pa gen pyès idantite!
                  </div>
                )}
                {driver.license_doc_url && (
                  <ProofThumb
                    path={driver.license_doc_url}
                    bucket="driver-documents"
                    alt={`Pèmi ${name}`}
                  />
                )}
                {driver.vehicle_photo_url && (
                  <ProofThumb
                    path={driver.vehicle_photo_url}
                    bucket="driver-documents"
                    alt={`Veyikil ${name}`}
                  />
                )}
              </div>
            </section>

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
                <KpiCard
                  label="Livrezon total"
                  value={String(driver.total_deliveries)}
                  icon={Bike}
                />
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
          </TabsContent>

          <TabsContent value="finans" className="space-y-6">
            <CommissionHistoryTable beneficiaryType="driver" beneficiaryId={driver.id} />
            <PayoutHistoryTable
              beneficiaryType="driver"
              beneficiaryId={driver.id}
              beneficiaryName={name}
            />
          </TabsContent>
        </Tabs>

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
                    disabled={isPending || !hasIdDoc}
                    title={
                      !hasIdDoc ? "Pyès idantite obligatwa a poko mete nan dosye a" : undefined
                    }
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
                <Button disabled={isPending} onClick={() => onStatusChange(driver.id, "approved")}>
                  Reyaktive
                </Button>
              )}
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

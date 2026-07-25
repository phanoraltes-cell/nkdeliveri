import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { DisputeThread } from "@/components/disputes/dispute-thread";
import {
  DISPUTE_STATUS_LABEL,
  DISPUTE_STATUS_TONE,
  DISPUTE_TERMINAL_STATUSES,
  DISPUTE_CATEGORY_GROUP_LABEL,
} from "@/lib/dispute-status";
import { inputClsCompact } from "@/lib/utils";

export type DisputeAdminDetail = {
  id: string;
  order_id: string;
  order_number: string;
  category: string;
  category_group: string;
  status: string;
  customer_id: string;
  restaurant_id: string;
  restaurant_name: string;
  driver_id: string | null;
  driver_first_name: string | null;
  driver_last_name: string | null;
  assigned_to: string | null;
  assigned_email: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
};

const NON_TERMINAL_STATUSES = ["open", "in_review", "action_required", "rejected", "escalated"];

type DisputeDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dispute: DisputeAdminDetail | null;
  currentUserId: string | undefined;
  onStatusChange: (status: string, notes: string, assignToMe?: boolean) => void;
  onResolve: (resolution: string) => void;
  isChangingStatus: boolean;
  isResolving: boolean;
};

/**
 * Full dispute view for admin: timeline (DisputeThread, including internal
 * notes/attachments), plus the status-transition controls the redesigned
 * `update_dispute_status_secure` RPC needs. "Rezoud" stays a separate
 * mandatory-ruling action (resolve_dispute_secure, via DisputeThread's own
 * canResolve form) — this dialog's buttons cover every other status.
 */
export function DisputeDetailDialog({
  open,
  onOpenChange,
  dispute,
  currentUserId,
  onStatusChange,
  onResolve,
  isChangingStatus,
  isResolving,
}: DisputeDetailDialogProps) {
  const [notes, setNotes] = useState("");

  if (!dispute) return null;

  const driverName = [dispute.driver_first_name, dispute.driver_last_name]
    .filter(Boolean)
    .join(" ");
  const isTerminal = DISPUTE_TERMINAL_STATUSES.has(dispute.status);
  const isAssignedToMe = dispute.assigned_to === currentUserId;

  function applyStatus(status: string) {
    onStatusChange(status, notes.trim());
    setNotes("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {dispute.order_number}
            <StatusBadge tone="neutral">
              {DISPUTE_CATEGORY_GROUP_LABEL[dispute.category_group] ?? dispute.category_group}
            </StatusBadge>
            <StatusBadge tone={DISPUTE_STATUS_TONE[dispute.status] ?? "neutral"}>
              {DISPUTE_STATUS_LABEL[dispute.status] ?? dispute.status}
            </StatusBadge>
          </DialogTitle>
          <DialogDescription>
            {dispute.restaurant_name}
            {driverName ? ` · ${driverName}` : ""} · {dispute.category} ·{" "}
            {new Date(dispute.created_at).toLocaleString("fr-HT")}
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm text-ink-soft">
          Chaje pa:{" "}
          <span className="font-bold text-ink">
            {dispute.assigned_email ?? "Pèsonn poko pran li"}
          </span>
          {!isTerminal && !isAssignedToMe && (
            <button
              onClick={() => onStatusChange(dispute.status, "", true)}
              className="ml-2 font-bold text-brand-deep hover:underline"
            >
              Pran li
            </button>
          )}
        </div>

        <DisputeThread
          disputeId={dispute.id}
          status={dispute.status}
          resolution={dispute.resolution}
          canResolve
          onResolve={onResolve}
          isResolving={isResolving}
        />

        {!isTerminal && (
          <section className="border-t border-brand-soft/40 pt-4">
            <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">
              Nòt entèn pou chanjman estati a (opsyonèl)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputClsCompact()}
              placeholder="Eksplike poukisa w ap chanje estati a…"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {NON_TERMINAL_STATUSES.filter((s) => s !== dispute.status).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === "rejected" ? "destructive" : "outline"}
                  disabled={isChangingStatus}
                  onClick={() => applyStatus(s)}
                >
                  {DISPUTE_STATUS_LABEL[s] ?? s}
                </Button>
              ))}
            </div>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

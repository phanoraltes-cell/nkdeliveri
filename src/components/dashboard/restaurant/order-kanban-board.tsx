import { useState } from "react";
import { Check, X, ChevronRight, Printer } from "lucide-react";
import { formatHTG } from "@/lib/format";
import { printKitchenTicket } from "@/lib/kitchen-ticket";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  getOrderWaitUrgency,
  formatOrderWaitTime,
  classifyUnconfirmedPayment,
} from "@/lib/order-status";
import { paymentMethodLabel } from "@/lib/payment-provider-availability";

export type KanbanOrder = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  subtotal?: number | null;
  delivery_fee?: number | null;
  delivery_address: string;
  delivery_notes: string | null;
  contact_phone?: string | null;
  created_at: string;
  order_items:
    { id: string; product_name: string; quantity: number; notes: string | null }[] | null;
  payments?:
    { status: string; method: string; payment_transactions?: { status: string }[] | null }[] | null;
};

type Column = { key: string; label: string; statuses: string[] };

const COLUMNS: Column[] = [
  { key: "pending", label: "Nouvo kòmand", statuses: ["pending"] },
  { key: "confirmed", label: "Konfime", statuses: ["confirmed"] },
  { key: "preparing", label: "Ap prepare", statuses: ["preparing"] },
  { key: "ready", label: "Prè", statuses: ["ready"] },
  { key: "delivering", label: "An livrezon", statuses: ["assigned", "picked_up"] },
  { key: "delivered", label: "Livre", statuses: ["delivered"] },
  { key: "cancelled", label: "Anile", statuses: ["cancelled", "refunded"] },
];

// Forward moves a restaurant owner/staff may trigger from the current
// status — same rule update_order_status_secure enforces server-side, kept
// in sync here so a drag onto an illegal column never even reaches the RPC.
const NEXT_COLUMN: Record<string, string> = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
};
const CANCELLABLE_FROM = new Set(["pending", "confirmed", "preparing", "ready"]);

// F-01 (docs/archive/audits/FULL_PLATFORM_AUDIT_2026-08-13.md): dragging a card is a
// second path to the exact same "pending -> confirmed" transition the
// "Konfime" button guards below -- without this check here too, a
// restaurant could drag around the button's disabled state and reach the
// same unconfirmed-payment case the button now blocks. Cancelling isn't
// gated on payment state (matches the button below, which never disables
// "Refize" for this reason), so only the confirm transition is checked.
function isValidDrop(
  fromStatus: string,
  toColumnKey: string,
  unconfirmedPayment: "manual" | "automatic" | null,
) {
  if (toColumnKey === "cancelled") return CANCELLABLE_FROM.has(fromStatus);
  if (NEXT_COLUMN[fromStatus] !== toColumnKey) return false;
  if (fromStatus === "pending" && toColumnKey === "confirmed" && unconfirmedPayment) return false;
  return true;
}

type OrderKanbanBoardProps = {
  orders: KanbanOrder[];
  restaurantName: string;
  onChangeStatus: (orderId: string, status: string) => void;
  isChangingStatus: boolean;
};

/** Restaurant orders as a 7-column Kanban board, with drag-and-drop between adjacent stages plus the same per-card action buttons as the list view. */
export function OrderKanbanBoard({
  orders,
  restaurantName,
  onChangeStatus,
  isChangingStatus,
}: OrderKanbanBoardProps) {
  const [dragOrder, setDragOrder] = useState<{
    id: string;
    status: string;
    unconfirmedPayment: "manual" | "automatic" | null;
  } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  function handleDrop(columnKey: string) {
    setDragOverCol(null);
    if (!dragOrder) return;
    if (!isValidDrop(dragOrder.status, columnKey, dragOrder.unconfirmedPayment)) return;
    const { id } = dragOrder;
    if (columnKey === "cancelled") {
      requestConfirm("Anile kòmand sa a?", () => onChangeStatus(id, "cancelled"));
    } else {
      onChangeStatus(id, columnKey);
    }
    setDragOrder(null);
  }

  function requestReject(orderId: string, orderNumber: string) {
    requestConfirm(`Refize kòmand ${orderNumber}?`, () => onChangeStatus(orderId, "cancelled"));
  }

  return (
    <>
      {/* touch-pan-x: on touch devices, tells the browser this row's only
          gesture is horizontal panning, so a finger drag reliably scrolls
          the columns instead of being intercepted by page-level vertical
          scroll heuristics — native HTML5 drag-and-drop (used below for
          desktop mouse drags between columns) doesn't fire from touch at
          all, so this row's horizontal swipe is the only touch interaction
          it needs to guarantee. */}
      <div className="flex touch-pan-x gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((col) => {
          const cards = orders.filter((o) => col.statuses.includes(o.status));
          const isDropTarget =
            dragOrder != null &&
            isValidDrop(dragOrder.status, col.key, dragOrder.unconfirmedPayment);
          return (
            <div
              key={col.key}
              onDragOver={(e) => {
                if (isDropTarget) {
                  e.preventDefault();
                  setDragOverCol(col.key);
                }
              }}
              onDragLeave={() => setDragOverCol((c) => (c === col.key ? null : c))}
              onDrop={() => handleDrop(col.key)}
              className={`w-[260px] shrink-0 rounded-2xl border-2 bg-brand-soft/10 p-2.5 transition-colors sm:w-[280px] ${
                dragOverCol === col.key
                  ? "border-brand bg-brand-soft/30"
                  : isDropTarget
                    ? "border-dashed border-brand-soft"
                    : "border-transparent"
              }`}
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <h3 className="font-display text-sm font-extrabold text-ink">{col.label}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-ink-soft">
                  {cards.length}
                </span>
              </div>

              <div className="space-y-2">
                {cards.map((o) => (
                  <KanbanCard
                    key={o.id}
                    order={o}
                    restaurantName={restaurantName}
                    draggable={NEXT_COLUMN[o.status] !== undefined}
                    onDragStart={() =>
                      setDragOrder({
                        id: o.id,
                        status: o.status,
                        unconfirmedPayment: classifyUnconfirmedPayment(o.payments?.[0]),
                      })
                    }
                    onDragEnd={() => {
                      setDragOrder(null);
                      setDragOverCol(null);
                    }}
                    onChangeStatus={onChangeStatus}
                    onRequestReject={requestReject}
                    isChangingStatus={isChangingStatus}
                  />
                ))}
                {cards.length === 0 && (
                  <div className="rounded-xl border border-dashed border-brand-soft/50 p-3 text-center text-[11px] text-ink-soft">
                    Vid
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {ConfirmDialog}
    </>
  );
}

function KanbanCard({
  order: o,
  restaurantName,
  draggable,
  onDragStart,
  onDragEnd,
  onChangeStatus,
  onRequestReject,
  isChangingStatus,
}: {
  order: KanbanOrder;
  restaurantName: string;
  draggable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onChangeStatus: (orderId: string, status: string) => void;
  onRequestReject: (orderId: string, orderNumber: string) => void;
  isChangingStatus: boolean;
}) {
  const itemCount = o.order_items?.reduce((s, it) => s + it.quantity, 0) ?? 0;
  const itemsWithNotes = o.order_items?.filter((it) => it.notes) ?? [];
  const paymentMethod = o.payments?.[0]?.method;
  const nextCol = NEXT_COLUMN[o.status];
  // Same guard as the "Lis" view (dashboard.restaurant.orders.tsx) via the
  // shared classifyUnconfirmedPayment source of truth — see F-01
  // (docs/archive/audits/FULL_PLATFORM_AUDIT_2026-08-13.md): before this fix, this button
  // had no payment-state guard at all, so a restaurant could confirm an
  // order whose moncash/natcash payment was still unconfirmed (manual
  // proof pending admin review, or automatic PLOP/Collect still in
  // flight), unlike the List view which already blocked it.
  const unconfirmedPayment = classifyUnconfirmedPayment(o.payments?.[0]);

  // Wait-time flag for the "Nouvo kòmand" column only — that's the queue
  // staff must act on fastest, so it's the one place a card sitting too
  // long is worth calling out. Computed at render time rather than on a
  // ticking interval: the board's own data query already refetches
  // periodically and on realtime order changes, which keeps this fresh
  // enough without a per-card timer. Shared with the "Lis" view (P11) via
  // lib/order-status.ts instead of each computing it separately.
  const { isUrgent, minutesWaiting } = getOrderWaitUrgency(o.status, o.created_at);

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-xl border border-brand-soft/50 bg-white p-3 shadow-brand-xs transition hover:shadow-brand-sm ${isUrgent ? "border-l-4 border-l-status-bad" : ""} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-display text-sm font-extrabold text-ink">{o.order_number}</span>
        <div className="flex items-center gap-1.5">
          <span className="font-display text-sm font-extrabold text-brand-deep">
            {formatHTG(Number(o.total))}
          </span>
          <button
            onClick={() =>
              printKitchenTicket({ ...o, order_items: o.order_items ?? [] }, restaurantName)
            }
            className="rounded-full p-1 text-ink-soft transition hover:bg-brand-soft/40 hover:text-brand-deep"
            aria-label="Enprime bon kizin"
            title="Enprime bon kizin"
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-soft">
        <span>
          {new Date(o.created_at).toLocaleTimeString("fr-HT", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          · {itemCount} atik
          {paymentMethod && ` · ${paymentMethodLabel(paymentMethod)}`}
        </span>
        {isUrgent && (
          <span className="rounded-full bg-status-bad-soft px-1.5 py-0.5 font-bold text-status-bad">
            {formatOrderWaitTime(minutesWaiting)} ap tann
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-[11px] text-ink-soft">{o.delivery_address}</div>
      {o.contact_phone && (
        <a
          href={`tel:${o.contact_phone}`}
          className="mt-0.5 block text-[11px] font-bold text-brand-deep"
        >
          {o.contact_phone}
        </a>
      )}
      {o.delivery_notes && (
        <div className="mt-1 truncate text-[11px] italic text-ink-soft">{o.delivery_notes}</div>
      )}
      {itemsWithNotes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {itemsWithNotes.map((it) => (
            <li key={it.id} className="truncate text-[11px] italic text-brand-deep">
              ↳ {it.product_name}: {it.notes}
            </li>
          ))}
        </ul>
      )}

      {(o.status === "pending" || nextCol) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {o.status === "pending" && (
            <>
              {/* Was two hand-rolled <button>s with hardcoded
                  bg-emerald-600/bg-red-600 (audit finding, docs/PHASE0_
                  PREPARATION_REPORT.md's design-system inventory) —
                  migrated onto the shared Button component. The "Lis"
                  view on this same screen (dashboard.restaurant.orders.tsx)
                  has the identical pattern and is not fixed by this
                  change — out of scope for this phase's Kanban-only
                  remediation, left for a future pass. flex-1 lets both
                  buttons share the card's width evenly instead of a
                  narrow inline pill. */}
              <Button
                size="sm"
                className="h-auto flex-1 gap-1 px-2.5 py-2"
                disabled={isChangingStatus || !!unconfirmedPayment}
                title={
                  unconfirmedPayment === "manual"
                    ? "Tann yon admin konfime prèv peman an anvan w konfime kòmand la"
                    : unconfirmedPayment === "automatic"
                      ? "Peman otomatik la an tretman — n ap tann konfimasyon sistèm peman an, pa gen okenn aksyon admin ki nesesè"
                      : undefined
                }
                onClick={() => onChangeStatus(o.id, "confirmed")}
              >
                <Check aria-hidden="true" />{" "}
                {unconfirmedPayment === "manual"
                  ? "Tann verifikasyon peman"
                  : unconfirmedPayment === "automatic"
                    ? "Peman ap tretman"
                    : "Konfime"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-auto flex-1 gap-1 px-2.5 py-2"
                disabled={isChangingStatus}
                onClick={() => onRequestReject(o.id, o.order_number)}
              >
                <X aria-hidden="true" /> Refize
              </Button>
            </>
          )}
          {nextCol && o.status !== "pending" && (
            <Button
              size="sm"
              className="h-auto gap-1 px-2.5 py-1.5 text-[11px]"
              disabled={isChangingStatus}
              onClick={() => onChangeStatus(o.id, nextCol)}
            >
              Avanse <ChevronRight className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

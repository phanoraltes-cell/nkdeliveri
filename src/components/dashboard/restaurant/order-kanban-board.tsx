import { useState } from "react";
import { Check, X, ChevronRight, Printer } from "lucide-react";
import { formatHTG } from "@/lib/format";
import { printKitchenTicket } from "@/lib/kitchen-ticket";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import { Button } from "@/components/ui/button";

export type KanbanOrder = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  delivery_address: string;
  delivery_notes: string | null;
  created_at: string;
  order_items:
    { id: string; product_name: string; quantity: number; notes: string | null }[] | null;
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

function isValidDrop(fromStatus: string, toColumnKey: string) {
  if (toColumnKey === "cancelled") return CANCELLABLE_FROM.has(fromStatus);
  return NEXT_COLUMN[fromStatus] === toColumnKey;
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
  const [dragOrder, setDragOrder] = useState<{ id: string; status: string } | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const { requestConfirm, ConfirmDialog } = useConfirmDialog();

  function handleDrop(columnKey: string) {
    setDragOverCol(null);
    if (!dragOrder) return;
    if (!isValidDrop(dragOrder.status, columnKey)) return;
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
      <div className="flex gap-3 overflow-x-auto pb-3">
        {COLUMNS.map((col) => {
          const cards = orders.filter((o) => col.statuses.includes(o.status));
          const isDropTarget = dragOrder != null && isValidDrop(dragOrder.status, col.key);
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
                    onDragStart={() => setDragOrder({ id: o.id, status: o.status })}
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
  const nextCol = NEXT_COLUMN[o.status];

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-xl border border-brand-soft/50 bg-white p-3 shadow-brand-xs transition hover:shadow-brand-sm ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
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
      <div className="mt-0.5 text-[11px] text-ink-soft">
        {new Date(o.created_at).toLocaleTimeString("fr-HT", { hour: "2-digit", minute: "2-digit" })}{" "}
        · {itemCount} atik
      </div>
      <div className="mt-1 truncate text-[11px] text-ink-soft">{o.delivery_address}</div>
      {o.delivery_notes && (
        <div className="mt-1 truncate text-[11px] italic text-ink-soft">{o.delivery_notes}</div>
      )}

      {(o.status === "pending" || nextCol) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {o.status === "pending" && (
            <>
              <button
                disabled={isChangingStatus}
                onClick={() => onChangeStatus(o.id, "confirmed")}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Konfime
              </button>
              <button
                disabled={isChangingStatus}
                onClick={() => onRequestReject(o.id, o.order_number)}
                className="inline-flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-red-700 disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Refize
              </button>
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

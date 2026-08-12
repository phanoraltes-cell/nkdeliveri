import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { MessageCircle, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { inputClsCompact } from "@/lib/utils";
import { ORDER_STATUS_LABEL } from "@/lib/order-status";
import {
  KOMAND_HEALTH_LABEL,
  KOMAND_HEALTH_TONE,
  KOMAND_ASSISTANCE_LABEL,
  KOMAND_ASSISTANCE_TONE,
  KOMAND_SUBSTATUS_LABEL,
} from "@/lib/komand-status";
import { useRealtimeTableSync } from "@/hooks/useRealtimeTableSync";

// Shape mirrors get_order_admin_detail()'s jsonb_build_object exactly
// (docs/KOMAND_ADMIN_AUDIT.md §Phase2, migration §5). Only the fields this
// dialog actually renders are typed — the RPC can carry more columns on
// `order`/`delivery`/`payment` (full to_jsonb() of each row) without this
// type needing to track every one of them.
type KomandCustomer = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
};
type KomandRestaurant = {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  avg_prep_time: number | null;
};
type KomandDriver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string;
} | null;
type KomandOrder = {
  id: string;
  order_number: string;
  status: string;
  total: number;
  subtotal: number | null;
  delivery_fee: number | null;
  delivery_address: string | null;
  contact_phone: string | null;
  delivery_notes: string | null;
  created_at: string;
};
type KomandDelivery = { status: string | null; updated_at: string | null } | null;
type KomandPayment = {
  method: string | null;
  status: string | null;
  cash_confirmation_status: string | null;
  transaction_ref: string | null;
  review_notes: string | null;
} | null;
type KomandItem = {
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};
type KomandDispute = { id: string; status: string; category: string; created_at: string } | null;
type KomandRefund = {
  id: string;
  status: string;
  amount: number;
  reason: string | null;
  created_at: string;
} | null;
type KomandAssistance = {
  order_id: string;
  status: string;
  assigned_admin_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
} | null;
type KomandNote = {
  id: string;
  note: string;
  created_at: string;
  author_id: string;
  author_name: string;
};

type KomandOrderDetail = {
  order: KomandOrder;
  customer: KomandCustomer;
  restaurant: KomandRestaurant;
  driver: KomandDriver;
  delivery: KomandDelivery;
  payment: KomandPayment;
  items: KomandItem[];
  dispute: KomandDispute;
  refund: KomandRefund;
  assistance: KomandAssistance;
  notes: KomandNote[];
};

function subLabel(v: string | null | undefined): string {
  if (!v) return "—";
  return KOMAND_SUBSTATUS_LABEL[v] ?? v;
}

type KomandDetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string | null;
  /** Currently-known health/assistance from the list row, shown instantly while the fuller detail query loads. */
  health?: string;
  currentUserId: string | undefined;
  /** Called after any mutation that could change what the list row shows (note added is excluded — it never affects the list). */
  onChanged?: () => void;
};

export function KomandDetailDialog({
  open,
  onOpenChange,
  orderId,
  health,
  currentUserId,
  onChanged,
}: KomandDetailDialogProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [note, setNote] = useState("");
  const [assistanceNote, setAssistanceNote] = useState("");

  const detailKey = ["admin-komand-detail", orderId] as const;
  const detail = useQuery({
    queryKey: detailKey,
    enabled: open && !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_order_admin_detail", { _order_id: orderId! });
      if (error) throw error;
      return data as unknown as KomandOrderDetail;
    },
  });

  // The two tables Komand introduces have no other realtime coverage yet —
  // a second admin adding a note or changing assistance status while this
  // dialog is open should show up without a manual close/reopen.
  useRealtimeTableSync(
    "komand_assistance",
    orderId ? `order_id=eq.${orderId}` : undefined,
    [detailKey],
    open && !!orderId,
  );
  useRealtimeTableSync(
    "order_admin_notes",
    orderId ? `order_id=eq.${orderId}` : undefined,
    [detailKey],
    open && !!orderId,
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: detailKey });
    onChanged?.();
  }

  const addNote = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error("Pa gen kòmand chwazi");
      const { error } = await supabase.rpc("add_order_admin_note_secure", {
        _order_id: orderId,
        _note: note.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: detailKey });
    },
    onError: (e) => toast.error(e.message),
  });

  const setAssistance = useMutation({
    mutationFn: async ({
      status,
      assignToMe,
    }: {
      status: "required" | "in_progress" | "resolved";
      assignToMe?: boolean;
    }) => {
      if (!orderId) throw new Error("Pa gen kòmand chwazi");
      const { error } = await supabase.rpc("set_komand_assistance_secure", {
        _order_id: orderId,
        _status: status,
        _assigned_admin_id: assignToMe ? currentUserId : undefined,
        _note: assistanceNote.trim() || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAssistanceNote("");
      toast.success("Estati asistans aktyalize");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const logContact = useMutation({
    mutationFn: async (
      action: "komand_client_contacted" | "komand_restaurant_contacted" | "komand_driver_contacted",
    ) => {
      if (!orderId) return;
      const { error } = await supabase.rpc("log_komand_contact_secure", {
        _order_id: orderId,
        _action: action,
      });
      if (error) throw error;
    },
  });

  function contact(
    action: "komand_client_contacted" | "komand_restaurant_contacted" | "komand_driver_contacted",
  ) {
    logContact.mutate(action);
    onOpenChange(false);
    navigate({ to: "/dashboard/admin/chat", search: { order: orderId ?? undefined } });
  }

  if (!orderId) return null;
  const d = detail.data;
  const assistanceStatus = d?.assistance?.status ?? "none";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {d?.order.order_number ?? "…"}
            {health && (
              <StatusBadge tone={KOMAND_HEALTH_TONE[health] ?? "neutral"}>
                {KOMAND_HEALTH_LABEL[health] ?? health}
              </StatusBadge>
            )}
            {assistanceStatus !== "none" && (
              <StatusBadge tone={KOMAND_ASSISTANCE_TONE[assistanceStatus] ?? "neutral"}>
                Asistans: {KOMAND_ASSISTANCE_LABEL[assistanceStatus] ?? assistanceStatus}
              </StatusBadge>
            )}
          </DialogTitle>
          <DialogDescription>
            {d
              ? `${ORDER_STATUS_LABEL[d.order.status] ?? d.order.status} · ${formatHTG(Number(d.order.total))} · ${new Date(d.order.created_at).toLocaleString("fr-HT")}`
              : "Ap chaje…"}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        )}

        {detail.isError && <p className="text-sm text-status-bad">Pa ka chaje detay kòmand la.</p>}

        {d && (
          <div className="space-y-5">
            {/* Client / restaurant / driver */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-brand-soft/50 p-3">
                <div className="text-xs font-bold uppercase text-ink-soft">Kliyan</div>
                <div className="mt-1 font-bold text-ink">
                  {[d.customer.first_name, d.customer.last_name].filter(Boolean).join(" ") || "—"}
                </div>
                <div className="text-xs text-ink-soft">{d.customer.phone ?? "—"}</div>
                <div className="truncate text-xs text-ink-soft">{d.customer.email ?? "—"}</div>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => {
                    onOpenChange(false);
                    navigate({
                      to: "/dashboard/admin/customers",
                      search: { customer: d.customer.id },
                    });
                  }}
                >
                  <Eye className="h-3.5 w-3.5" /> Pwofil
                </Button>
              </div>
              <div className="rounded-xl border border-brand-soft/50 p-3">
                <div className="text-xs font-bold uppercase text-ink-soft">Restoran</div>
                <div className="mt-1 font-bold text-ink">{d.restaurant.name}</div>
                <div className="text-xs text-ink-soft">{d.restaurant.phone ?? "—"}</div>
                <div className="text-xs text-ink-soft">
                  Tan prepare mwayèn: {d.restaurant.avg_prep_time ?? "—"} min
                </div>
              </div>
              <div className="rounded-xl border border-brand-soft/50 p-3">
                <div className="text-xs font-bold uppercase text-ink-soft">Livrè</div>
                {d.driver ? (
                  <>
                    <div className="mt-1 font-bold text-ink">
                      {[d.driver.first_name, d.driver.last_name].filter(Boolean).join(" ") || "—"}
                    </div>
                    <div className="text-xs text-ink-soft">{d.driver.phone ?? "—"}</div>
                  </>
                ) : (
                  <div className="mt-1 text-xs text-ink-soft">Poko asiyen</div>
                )}
              </div>
            </div>

            {/* Order / payment / delivery */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-brand-soft/50 p-3">
                <div className="text-xs font-bold uppercase text-ink-soft">Kòmand</div>
                <div className="mt-1 text-xs text-ink-soft">
                  Adrès: {d.order.delivery_address ?? "—"}
                </div>
                <div className="text-xs text-ink-soft">Tel: {d.order.contact_phone ?? "—"}</div>
                {d.order.delivery_notes && (
                  <div className="text-xs text-ink-soft">Nòt: {d.order.delivery_notes}</div>
                )}
              </div>
              <div className="rounded-xl border border-brand-soft/50 p-3">
                <div className="text-xs font-bold uppercase text-ink-soft">Peman</div>
                <div className="mt-1 text-xs text-ink-soft">Metòd: {d.payment?.method ?? "—"}</div>
                <div className="text-xs text-ink-soft">Estati: {subLabel(d.payment?.status)}</div>
                {d.payment?.cash_confirmation_status && (
                  <div className="text-xs text-ink-soft">
                    Konfimasyon kach: {subLabel(d.payment.cash_confirmation_status)}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-brand-soft/50 p-3">
                <div className="text-xs font-bold uppercase text-ink-soft">Livrezon</div>
                <div className="mt-1 text-xs text-ink-soft">
                  Estati: {subLabel(d.delivery?.status)}
                </div>
                {d.delivery?.updated_at && (
                  <div className="text-xs text-ink-soft">
                    Dènye aktivite: {new Date(d.delivery.updated_at).toLocaleString("fr-HT")}
                  </div>
                )}
              </div>
            </div>

            {/* Items */}
            {d.items.length > 0 && (
              <div className="rounded-xl border border-brand-soft/50 p-3">
                <div className="mb-1 text-xs font-bold uppercase text-ink-soft">Atik</div>
                <ul className="space-y-1 text-sm">
                  {d.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        {it.quantity}× {it.product_name}
                      </span>
                      <span className="font-medium text-ink">
                        {formatHTG(Number(it.line_total))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Dispute / refund, if any */}
            {(d.dispute || d.refund) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {d.dispute && (
                  <div className="rounded-xl border border-status-bad-soft bg-status-bad-soft/30 p-3">
                    <div className="text-xs font-bold uppercase text-status-bad">Litij</div>
                    <div className="mt-1 text-xs text-ink-soft">
                      {d.dispute.category} · {d.dispute.status}
                    </div>
                  </div>
                )}
                {d.refund && (
                  <div className="rounded-xl border border-status-warn-soft bg-status-warn-soft/30 p-3">
                    <div className="text-xs font-bold uppercase text-status-warn">Ranbousman</div>
                    <div className="mt-1 text-xs text-ink-soft">
                      {formatHTG(Number(d.refund.amount))} · {subLabel(d.refund.status)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Contact */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => contact("komand_client_contacted")}
              >
                <MessageCircle className="h-3.5 w-3.5" /> Kontakte kliyan
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => contact("komand_restaurant_contacted")}
              >
                <MessageCircle className="h-3.5 w-3.5" /> Kontakte restoran
              </Button>
              {d.driver && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => contact("komand_driver_contacted")}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Kontakte livrè
                </Button>
              )}
            </div>

            {/* Assistance controls */}
            <section className="border-t border-brand-soft/40 pt-4">
              <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Asistans administratif (pa touche estati kòmand la)
              </label>
              <textarea
                value={assistanceNote}
                onChange={(e) => setAssistanceNote(e.target.value)}
                rows={2}
                className={inputClsCompact()}
                placeholder="Nòt sou entèvansyon an (opsyonèl)…"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {assistanceStatus !== "required" && assistanceStatus !== "resolved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setAssistance.isPending}
                    onClick={() => setAssistance.mutate({ status: "required" })}
                  >
                    Make kòm bezwen asistans
                  </Button>
                )}
                {assistanceStatus !== "in_progress" && assistanceStatus !== "resolved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setAssistance.isPending}
                    onClick={() =>
                      setAssistance.mutate({ status: "in_progress", assignToMe: true })
                    }
                  >
                    Pran li (an kou)
                  </Button>
                )}
                {assistanceStatus !== "resolved" && assistanceStatus !== "none" && (
                  <Button
                    size="sm"
                    disabled={setAssistance.isPending}
                    onClick={() => setAssistance.mutate({ status: "resolved" })}
                  >
                    Make kòm rezoud
                  </Button>
                )}
              </div>
            </section>

            {/* Internal notes */}
            <section className="border-t border-brand-soft/40 pt-4">
              <label className="mb-1 block text-xs font-bold uppercase text-ink-soft">
                Nòt entèn (admin sèlman)
              </label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className={inputClsCompact()}
                placeholder="Ekri yon nòt entèn sou kòmand sa a…"
              />
              <Button
                size="sm"
                className="mt-2"
                disabled={!note.trim() || addNote.isPending}
                onClick={() => addNote.mutate()}
              >
                {addNote.isPending ? "Ap ajoute…" : "Ajoute nòt"}
              </Button>

              {d.notes.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {d.notes.map((n) => (
                    <li key={n.id} className="rounded-lg bg-brand-soft/20 p-2 text-xs">
                      <div className="flex justify-between gap-2 text-ink-soft">
                        <span className="font-bold text-ink">{n.author_name || "Admin"}</span>
                        <span>{new Date(n.created_at).toLocaleString("fr-HT")}</span>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-ink">{n.note}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

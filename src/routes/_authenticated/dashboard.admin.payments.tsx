import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sendPaymentReviewPush } from "@/lib/send-push.functions";
import { formatHTG } from "@/lib/format";
import { CheckCircle2, XCircle } from "lucide-react";
import { ProofThumb } from "@/components/proof-thumb";
import { toast } from "sonner";
import { useState } from "react";
import { Download, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/admin/payments")({
  beforeLoad: ({ context }) => {
    const role = (context as any).role;
    if (role !== "admin" && role !== "super_admin") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: AdminPayments,
});

function AdminPayments() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [filter, setFilter] = useState<"all" | "moncash" | "natcash">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "paid" | "failed">("all");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState<string>(monthAgo);
  const [toDate, setToDate] = useState<string>(today);
  const sendPush = useServerFn(sendPaymentReviewPush);

  const list = useQuery({
    queryKey: ["admin-manual-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, method, status, amount, currency, created_at, transaction_ref, sender_phone, order_id, orders(order_number, total, customer_id, restaurants(name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at)"
        )
        .in("method", ["moncash", "natcash"])
        .in("status", ["awaiting_proof", "under_review"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const history = useQuery({
    queryKey: ["admin-payout-history"],
    enabled: tab === "history",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select(
          "id, method, status, amount, currency, created_at, reviewed_at, review_notes, transaction_ref, sender_phone, receiver_type, receiver_account_name, receiver_number, order_id, orders(order_number, total, subtotal, delivery_fee, status, created_at, customer_id, delivery_address, restaurants(name, phone), order_items(id, quantity, unit_price, product_name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at)"
        )
        .in("method", ["moncash", "natcash"])
        .in("status", ["paid", "failed"])
        .order("reviewed_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  const decide = useMutation({
    mutationFn: async ({ id, decision, note }: { id: string; decision: "paid" | "failed"; note?: string }) => {
      const { error } = await supabase
        .from("payments")
        .update({
          status: decision,
          review_notes: note || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
      // Fire-and-log web push to customer + merchant
      try {
        await sendPush({ data: { paymentId: id } });
      } catch (e) {
        console.warn("push send failed", e);
      }
    },
    onSuccess: (_d, v) => {
      toast.success(v.decision === "paid" ? "Peman apwouve, kòmand konfime" : "Peman rejte");
      qc.invalidateQueries({ queryKey: ["admin-manual-payments"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-extrabold text-ink">Peman manyèl</h1>
          <p className="mt-1 text-ink-soft">Valide prèv MonCash ak NatCash.</p>
        </div>
        <Link to="/dashboard/admin" className="text-sm font-bold text-brand-deep hover:underline">
          ← Admin
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-brand-soft/60">
        <button
          onClick={() => setTab("pending")}
          className={`px-4 py-2 text-sm font-bold ${tab === "pending" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          An atant {list.data?.length ? `(${list.data.length})` : ""}
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm font-bold ${tab === "history" ? "border-b-2 border-brand-deep text-brand-deep" : "text-ink-soft hover:text-ink"}`}
        >
          Payout history
        </button>
      </div>

      {tab === "pending" && (
      <>
      {list.isLoading && <div className="text-ink-soft">Chajman…</div>}
      {list.data?.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen peman manyèl an atant.
        </div>
      )}

      <div className="space-y-4">
        {list.data?.map((p: any) => (
          <div key={p.id} className="rounded-2xl border border-brand-soft/60 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-display text-lg font-extrabold">
                  {p.orders?.order_number}
                  <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-brand-deep">
                    {p.method}
                  </span>
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
                    {p.status}
                  </span>
                </div>
                <div className="text-xs text-ink-soft">
                  {p.orders?.restaurants?.name} · {new Date(p.created_at).toLocaleString("fr-HT")}
                </div>
              </div>
              <div className="text-right font-display text-xl font-extrabold text-brand-deep">
                {formatHTG(Number(p.amount))}
              </div>
            </div>

            {p.transaction_ref && (
              <div className="mt-2 text-sm">Tx: <b>{p.transaction_ref}</b></div>
            )}
            {p.sender_phone && (
              <div className="text-sm">Soti nan: <b>{p.sender_phone}</b></div>
            )}

            {p.payment_proofs?.length > 0 ? (
              <div className="mt-3">
                <div className="mb-2 text-xs font-bold uppercase text-ink-soft">Prèv peman</div>
                <div className="flex flex-wrap gap-3">
                  {p.payment_proofs.map((pr: any) => (
                    <div key={pr.id} className="space-y-1">
                      <ProofThumb path={pr.file_url} />
                      {(pr.transaction_ref || pr.sender_phone) && (
                        <div className="max-w-[96px] text-[10px] leading-tight text-ink-soft">
                          {pr.transaction_ref && <div>Tx: <b>{pr.transaction_ref}</b></div>}
                          {pr.sender_phone && <div>{pr.sender_phone}</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Poko gen prèv voye.
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={notes[p.id] || ""}
                onChange={(e) => setNotes((s) => ({ ...s, [p.id]: e.target.value }))}
                placeholder="Nòt (opsyonèl)"
                className="flex-1 rounded-full border-2 border-brand-soft bg-white px-3 py-1.5 text-sm"
              />
              <button
                disabled={!p.payment_proofs?.length || decide.isPending}
                onClick={() => decide.mutate({ id: p.id, decision: "paid", note: notes[p.id] })}
                className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Apwouve
              </button>
              <button
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: p.id, decision: "failed", note: notes[p.id] })}
                className="inline-flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700"
              >
                <XCircle className="h-3.5 w-3.5" /> Rejte
              </button>
            </div>
          </div>
        ))}
      </div>
      </>
      )}

      {tab === "history" && (
        <PayoutHistory
          data={history.data}
          loading={history.isLoading}
          filter={filter}
          setFilter={setFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
        />
      )}
    </div>
  );
}

function PayoutHistory({
  data,
  loading,
  filter,
  setFilter,
  statusFilter,
  setStatusFilter,
  fromDate,
  toDate,
  setFromDate,
  setToDate,
}: {
  data: any[] | undefined;
  loading: boolean;
  filter: "all" | "moncash" | "natcash";
  setFilter: (v: "all" | "moncash" | "natcash") => void;
  statusFilter: "all" | "paid" | "failed";
  setStatusFilter: (v: "all" | "paid" | "failed") => void;
  fromDate: string;
  toDate: string;
  setFromDate: (v: string) => void;
  setToDate: (v: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = (data || []).filter((p) => {
    if (filter !== "all" && p.method !== filter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    const d = new Date(p.reviewed_at || p.created_at);
    if (fromDate && d < new Date(fromDate + "T00:00:00")) return false;
    if (toDate && d > new Date(toDate + "T23:59:59")) return false;
    return true;
  });

  const totalPaid = filtered
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  const rows = filtered.map((p) => ({
    date: new Date(p.reviewed_at || p.created_at).toLocaleString("fr-HT"),
    order: p.orders?.order_number || "",
    restaurant: p.orders?.restaurants?.name || "",
    method: (p.method || "").toUpperCase(),
    tx: p.transaction_ref || "",
    sender: p.sender_phone || "",
    receiver: [p.receiver_type, p.receiver_account_name, p.receiver_number].filter(Boolean).join(" · "),
    amount: Number(p.amount || 0),
    status: p.status,
    notes: p.review_notes || "",
  }));

  function exportCSV() {
    const headers = ["Dat", "Kòmand", "Restoran", "Metòd", "Tx", "Soti nan", "Voye bay", "Mòn (HTG)", "Estati", "Nòt"];
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        [r.date, r.order, r.restaurant, r.method, r.tx, r.sender, r.receiver, r.amount, r.status, r.notes]
          .map((v) => {
            const s = String(v ?? "").replace(/"/g, '""');
            return /[",\n]/.test(s) ? `"${s}"` : s;
          })
          .join(",")
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payout-history_${fromDate}_${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV telechaje");
  }

  async function exportPDF() {
    // jspdf + jspdf-autotable pull in ~1.3MB of transitive deps (html2canvas,
    // canvg, etc.) — loaded on demand so admins who never export PDF never
    // pay for it, and it drops out of the SSR bundle entirely.
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text("NK Delivery - Payout history", 40, 40);
    doc.setFontSize(10);
    doc.text(`Peryòd: ${fromDate} → ${toDate}`, 40, 58);
    doc.text(
      `Metòd: ${filter} · Estati: ${statusFilter} · Total apwouve: ${formatHTG(totalPaid)} · ${rows.length} peman`,
      40,
      74
    );
    autoTable(doc, {
      startY: 90,
      head: [["Dat", "Kòmand", "Restoran", "Metòd", "Tx", "Voye bay", "Mòn", "Estati"]],
      body: rows.map((r) => [
        r.date,
        r.order,
        r.restaurant,
        r.method,
        r.tx,
        r.receiver,
        formatHTG(r.amount),
        r.status,
      ]),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [234, 88, 12] },
    });
    doc.save(`payout-history_${fromDate}_${toDate}.pdf`);
    toast.success("PDF telechaje");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["all", "moncash", "natcash"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setFilter(m)}
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${filter === m ? "bg-brand-deep text-white" : "bg-brand-soft/60 text-brand-deep"}`}
          >
            {m === "all" ? "Tout metòd" : m}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-brand-soft" />
        {(["all", "paid", "failed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${statusFilter === s ? "bg-ink text-white" : "bg-brand-soft/60 text-ink"}`}
          >
            {s === "all" ? "Tout" : s === "paid" ? "Apwouve" : "Rejte"}
          </button>
        ))}
        <span className="mx-2 h-4 w-px bg-brand-soft" />
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Depi
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-ink-soft">
          Jiska
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded-md border border-brand-soft bg-white px-2 py-1 text-xs"
          />
        </label>
        <button
          onClick={exportCSV}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <Download className="h-3.5 w-3.5" /> CSV
        </button>
        <button
          onClick={exportPDF}
          disabled={rows.length === 0}
          className="inline-flex items-center gap-1 rounded-full bg-brand-deep px-3 py-1 text-xs font-bold text-white hover:opacity-90 disabled:opacity-50"
        >
          <FileText className="h-3.5 w-3.5" /> PDF
        </button>
        <div className="ml-auto text-sm text-ink-soft">
          Total apwouve: <b className="text-brand-deep">{formatHTG(totalPaid)}</b> · {filtered.length} peman
        </div>
      </div>

      {loading && <div className="text-ink-soft">Chajman…</div>}
      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl border border-brand-soft/60 bg-white p-6 text-center text-ink-soft">
          Pa gen istorik pou filtè sa yo.
        </div>
      )}

      <div className="rounded-2xl border border-brand-soft/60 bg-white shadow-sm">
       <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-brand-soft/40 text-left text-xs uppercase text-ink-soft">
            <tr>
              <th className="px-3 py-2">Dat</th>
              <th className="px-3 py-2">Kòmand</th>
              <th className="px-3 py-2">Restoran</th>
              <th className="px-3 py-2">Metòd</th>
              <th className="px-3 py-2">Tx</th>
              <th className="px-3 py-2 text-right">Mòn</th>
              <th className="px-3 py-2">Estati</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const open = openId === p.id;
              return (
                <>
                  <tr key={p.id} className="border-t border-brand-soft/40 hover:bg-brand-soft/20">
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {new Date(p.reviewed_at || p.created_at).toLocaleString("fr-HT")}
                    </td>
                    <td className="px-3 py-2 font-bold">{p.orders?.order_number}</td>
                    <td className="px-3 py-2">{p.orders?.restaurants?.name || "—"}</td>
                    <td className="px-3 py-2 uppercase">{p.method}</td>
                    <td className="px-3 py-2 text-xs">{p.transaction_ref || "—"}</td>
                    <td className="px-3 py-2 text-right font-bold text-brand-deep">
                      {formatHTG(Number(p.amount))}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          p.status === "paid"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => setOpenId(open ? null : p.id)}
                        className="text-xs font-bold text-brand-deep hover:underline"
                      >
                        {open ? "Fèmen" : "Detay"}
                      </button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-brand-soft/40 bg-brand-soft/10">
                      <td colSpan={8} className="px-4 py-4">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="space-y-1 text-sm">
                            <div className="font-display text-base font-extrabold text-ink">Kòmand</div>
                            <div>Nimewo: <b>{p.orders?.order_number}</b></div>
                            <div>Estati kòmand: <b>{p.orders?.status}</b></div>
                            <div>Sub-total: <b>{formatHTG(Number(p.orders?.subtotal || 0))}</b></div>
                            <div>Frè livrezon: <b>{formatHTG(Number(p.orders?.delivery_fee || 0))}</b></div>
                            <div>Total: <b>{formatHTG(Number(p.orders?.total || 0))}</b></div>
                            {p.orders?.delivery_address && (
                              <div className="text-xs text-ink-soft">
                                Adrès: {typeof p.orders.delivery_address === "string"
                                  ? p.orders.delivery_address
                                  : JSON.stringify(p.orders.delivery_address)}
                              </div>
                            )}
                            <Link
                              to="/orders/$id"
                              params={{ id: p.order_id }}
                              className="mt-2 inline-block text-xs font-bold text-brand-deep hover:underline"
                            >
                              Ouvri paj kòmand →
                            </Link>
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="font-display text-base font-extrabold text-ink">Peman</div>
                            <div>Metòd: <b className="uppercase">{p.method}</b></div>
                            <div>Voye bay: <b>{p.receiver_type || "—"}</b> {p.receiver_account_name ? `· ${p.receiver_account_name}` : ""}</div>
                            {p.receiver_number && <div>Nimewo resevè: <b>{p.receiver_number}</b></div>}
                            {p.sender_phone && <div>Soti nan: <b>{p.sender_phone}</b></div>}
                            {p.transaction_ref && <div>Tx: <b>{p.transaction_ref}</b></div>}
                            {p.reviewed_at && (
                              <div className="text-xs text-ink-soft">
                                Revize: {new Date(p.reviewed_at).toLocaleString("fr-HT")}
                              </div>
                            )}
                            {p.review_notes && (
                              <div className="rounded-lg bg-white p-2 text-xs">
                                Nòt admin: {p.review_notes}
                              </div>
                            )}
                          </div>
                          {p.orders?.order_items?.length > 0 && (
                            <div className="md:col-span-2">
                              <div className="mb-1 font-display text-sm font-extrabold text-ink">Atik</div>
                              <ul className="divide-y divide-brand-soft/40 rounded-lg border border-brand-soft/40 bg-white text-xs">
                                {p.orders.order_items.map((it: any) => (
                                  <li key={it.id} className="flex justify-between px-3 py-1.5">
                                    <span>{it.quantity}× {it.product_name}</span>
                                    <span className="font-bold">{formatHTG(Number(it.unit_price) * Number(it.quantity))}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {p.payment_proofs?.length > 0 && (
                            <div className="md:col-span-2">
                              <div className="mb-1 font-display text-sm font-extrabold text-ink">Prèv peman</div>
                              <div className="flex flex-wrap gap-3">
                                {p.payment_proofs.map((pr: any) => (
                                  <ProofThumb key={pr.id} path={pr.file_url} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
       </div>
      </div>
    </div>
  );
}
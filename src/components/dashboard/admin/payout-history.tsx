import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, FileText } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatHTG } from "@/lib/format";
import { downloadCSV } from "@/lib/csv-export";
import { ProofThumb } from "@/components/proof-thumb";
import { StatusBadge } from "@/components/dashboard/status-badge";

export async function fetchPayoutHistory() {
  const { data, error } = await supabase
    .from("payments")
    .select(
      "id, method, status, amount, currency, created_at, reviewed_at, review_notes, transaction_ref, sender_phone, receiver_type, receiver_account_name, receiver_number, order_id, orders(order_number, total, subtotal, delivery_fee, status, created_at, customer_id, delivery_address, restaurants(name, phone), order_items(id, quantity, unit_price, product_name)), payment_proofs(id, file_url, transaction_ref, sender_phone, notes, created_at)",
    )
    .in("method", ["moncash", "natcash"])
    .in("status", ["paid", "failed"])
    .order("reviewed_at", { ascending: false, nullsFirst: false })
    .limit(200);
  if (error) throw error;
  return data;
}

export type PayoutHistoryRow = NonNullable<Awaited<ReturnType<typeof fetchPayoutHistory>>>[number];

type PayoutHistoryProps = {
  data: PayoutHistoryRow[] | undefined;
  loading: boolean;
  filter: "all" | "moncash" | "natcash";
  setFilter: (v: "all" | "moncash" | "natcash") => void;
  statusFilter: "all" | "paid" | "failed";
  setStatusFilter: (v: "all" | "paid" | "failed") => void;
  fromDate: string;
  toDate: string;
  setFromDate: (v: string) => void;
  setToDate: (v: string) => void;
};

/** Admin dashboard's reviewed MonCash/NatCash payout history: filters, CSV/PDF export, and an expandable detail row per payment. */
export function PayoutHistory({
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
}: PayoutHistoryProps) {
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
    receiver: [p.receiver_type, p.receiver_account_name, p.receiver_number]
      .filter(Boolean)
      .join(" · "),
    amount: Number(p.amount || 0),
    status: p.status,
    notes: p.review_notes || "",
  }));

  function exportCSV() {
    const headers = [
      "Dat",
      "Kòmand",
      "Restoran",
      "Metòd",
      "Tx",
      "Soti nan",
      "Voye bay",
      "Mòn (HTG)",
      "Estati",
      "Nòt",
    ];
    downloadCSV(
      `payout-history_${fromDate}_${toDate}.csv`,
      headers,
      rows.map((r) => [
        r.date,
        r.order,
        r.restaurant,
        r.method,
        r.tx,
        r.sender,
        r.receiver,
        r.amount,
        r.status,
        r.notes,
      ]),
    );
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
    doc.text("NK Deliveri - Payout history", 40, 40);
    doc.setFontSize(10);
    doc.text(`Peryòd: ${fromDate} → ${toDate}`, 40, 58);
    doc.text(
      `Metòd: ${filter} · Estati: ${statusFilter} · Total apwouve: ${formatHTG(totalPaid)} · ${rows.length} peman`,
      40,
      74,
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
          Total apwouve: <b className="text-brand-deep">{formatHTG(totalPaid)}</b> ·{" "}
          {filtered.length} peman
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
                  <Fragment key={p.id}>
                    <tr className="border-t border-brand-soft/40 hover:bg-brand-soft/20">
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
                        <StatusBadge tone={p.status === "paid" ? "good" : "bad"}>
                          {p.status}
                        </StatusBadge>
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
                              <div className="font-display text-base font-extrabold text-ink">
                                Kòmand
                              </div>
                              <div>
                                Nimewo: <b>{p.orders?.order_number}</b>
                              </div>
                              <div>
                                Estati kòmand: <b>{p.orders?.status}</b>
                              </div>
                              <div>
                                Sub-total: <b>{formatHTG(Number(p.orders?.subtotal || 0))}</b>
                              </div>
                              <div>
                                Frè livrezon:{" "}
                                <b>{formatHTG(Number(p.orders?.delivery_fee || 0))}</b>
                              </div>
                              <div>
                                Total: <b>{formatHTG(Number(p.orders?.total || 0))}</b>
                              </div>
                              {p.orders?.delivery_address && (
                                <div className="text-xs text-ink-soft">
                                  Adrès:{" "}
                                  {typeof p.orders.delivery_address === "string"
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
                              <div className="font-display text-base font-extrabold text-ink">
                                Peman
                              </div>
                              <div>
                                Metòd: <b className="uppercase">{p.method}</b>
                              </div>
                              <div>
                                Voye bay: <b>{p.receiver_type || "—"}</b>{" "}
                                {p.receiver_account_name ? `· ${p.receiver_account_name}` : ""}
                              </div>
                              {p.receiver_number && (
                                <div>
                                  Nimewo resevè: <b>{p.receiver_number}</b>
                                </div>
                              )}
                              {p.sender_phone && (
                                <div>
                                  Soti nan: <b>{p.sender_phone}</b>
                                </div>
                              )}
                              {p.transaction_ref && (
                                <div>
                                  Tx: <b>{p.transaction_ref}</b>
                                </div>
                              )}
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
                                <div className="mb-1 font-display text-sm font-extrabold text-ink">
                                  Atik
                                </div>
                                <ul className="divide-y divide-brand-soft/40 rounded-lg border border-brand-soft/40 bg-white text-xs">
                                  {p.orders.order_items.map((it) => (
                                    <li key={it.id} className="flex justify-between px-3 py-1.5">
                                      <span>
                                        {it.quantity}× {it.product_name}
                                      </span>
                                      <span className="font-bold">
                                        {formatHTG(Number(it.unit_price) * Number(it.quantity))}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {p.payment_proofs?.length > 0 && (
                              <div className="md:col-span-2">
                                <div className="mb-1 font-display text-sm font-extrabold text-ink">
                                  Prèv peman
                                </div>
                                <div className="flex flex-wrap gap-3">
                                  {p.payment_proofs.map((pr) => (
                                    <ProofThumb key={pr.id} path={pr.file_url} />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

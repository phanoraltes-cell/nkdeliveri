import { formatHTG } from "@/lib/format";
import { PAYOUT_STATUS_LABEL } from "@/lib/payout-status";
import { toAmount } from "@/lib/money";

export type PayoutReceiptData = {
  id: string;
  amount: number;
  method: string;
  receiverNumber: string;
  receiverAccountName: string | null;
  transactionReference: string;
  status: string;
  beneficiaryName: string;
  createdAt: string;
  /** Tach 3D — present only for a self-service withdrawal request that had a withdrawal_rules fee applied; omitted (undefined) for every payout that predates that feature or carries no fee, so the receipt shows nothing extra for them. */
  feeAmount?: number;
  netAmount?: number;
};

/**
 * One-payout PDF receipt — reused by the admin, restaurant, and driver
 * payout-history views. jspdf is lazy-imported (same ~1.3MB-of-transitive-
 * deps rationale as payout-history.tsx's CSV/PDF export), so it never loads
 * until someone actually clicks "Telechaje resi".
 */
export async function generatePayoutReceipt(payout: PayoutReceiptData) {
  const { default: jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a5" });

  doc.setFontSize(16);
  doc.text("NK Deliveri", 40, 48);
  doc.setFontSize(11);
  doc.text("Resi peman", 40, 68);

  doc.setDrawColor(234, 88, 12);
  doc.line(40, 80, 380, 80);

  const rows: [string, string][] = [
    ["Benefisyè", payout.beneficiaryName],
    ["Montan mande", formatHTG(payout.amount)],
    // `payout.netAmount ?? (amount - feeAmount)` te gen yon pyèj: `??` PA
    // kenbe NaN. `netAmount: Number(r.net_amount)` sou yon peman ki
    // pre-Tach 3D (kote `net_amount` se NULL) bay NaN, epi NaN pase tou
    // dwat nan resi a — yon dokiman yon benefisyè kenbe kòm prèv, ki di
    // « Montan resevwa (nèt): NaN HTG ». Nou kalkile nèt la sèlman lè de
    // pati yo valab.
    ...(() => {
      const fee = toAmount(payout.feeAmount);
      if (fee === null || fee <= 0) return [];
      const gross = toAmount(payout.amount);
      const net = toAmount(payout.netAmount) ?? (gross === null ? null : gross - fee);
      return [
        ["Frè", formatHTG(fee)],
        ["Montan resevwa (nèt)", formatHTG(net)],
      ] as [string, string][];
    })(),
    ["Metòd", payout.method.toUpperCase()],
    ["Nimewo resevwa", payout.receiverNumber],
    ...(payout.receiverAccountName
      ? ([["Non kont", payout.receiverAccountName]] as [string, string][])
      : []),
    ["Referans tranzaksyon", payout.transactionReference],
    ["Estati", PAYOUT_STATUS_LABEL[payout.status] ?? payout.status],
    ["Dat", new Date(payout.createdAt).toLocaleString("fr-HT")],
    ["ID peman", payout.id],
  ];

  let y = 108;
  doc.setFontSize(10);
  for (const [label, value] of rows) {
    doc.setTextColor(120, 113, 108);
    doc.text(label, 40, y);
    doc.setTextColor(28, 25, 23);
    doc.text(value, 190, y, { maxWidth: 200 });
    y += 24;
  }

  doc.save(`resi-peman_${payout.id.slice(0, 8)}.pdf`);
}

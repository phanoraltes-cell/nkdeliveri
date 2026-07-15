export type KitchenTicketItem = {
  product_name: string;
  quantity: number;
  notes?: string | null;
};

export type KitchenTicketOrder = {
  order_number: string;
  created_at: string;
  delivery_address: string;
  delivery_notes?: string | null;
  contact_phone?: string | null;
  order_items: KitchenTicketItem[];
};

const TICKET_WIDTH_MM = 80;
const MARGIN_MM = 4;
const LINE_HEIGHT_MM = 5;

/**
 * Builds a printable kitchen ticket for one order — an 80mm thermal-receipt
 * page format (jsPDF's `format: [width, height]` option), sized to its
 * content since the item count varies per order. Drawn with plain
 * doc.text()/doc.line() rather than jspdf-autotable: a kitchen ticket is a
 * single narrow column, not a table, and autotable's column-fitting logic
 * doesn't suit it.
 */
export async function printKitchenTicket(order: KitchenTicketOrder, restaurantName: string) {
  const { default: jsPDF } = await import("jspdf");

  const itemLines = order.order_items.reduce((n, it) => n + 1 + (it.notes ? 1 : 0), 0);
  const notesLines = order.delivery_notes ? 2 : 0;
  const heightMm = 44 + itemLines * LINE_HEIGHT_MM + notesLines * LINE_HEIGHT_MM;

  const doc = new jsPDF({ unit: "mm", format: [TICKET_WIDTH_MM, heightMm] });
  const contentWidth = TICKET_WIDTH_MM - MARGIN_MM * 2;
  let y = MARGIN_MM + 3;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(restaurantName, TICKET_WIDTH_MM / 2, y, { align: "center" });
  y += LINE_HEIGHT_MM;

  doc.setFontSize(10);
  doc.text(`Bon kizin — ${order.order_number}`, TICKET_WIDTH_MM / 2, y, { align: "center" });
  y += LINE_HEIGHT_MM - 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(new Date(order.created_at).toLocaleString("fr-HT"), TICKET_WIDTH_MM / 2, y, {
    align: "center",
  });
  y += LINE_HEIGHT_MM;

  doc.setLineWidth(0.2);
  doc.line(MARGIN_MM, y, TICKET_WIDTH_MM - MARGIN_MM, y);
  y += LINE_HEIGHT_MM - 1;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  for (const item of order.order_items) {
    const line = doc.splitTextToSize(`${item.quantity}x ${item.product_name}`, contentWidth);
    doc.text(line, MARGIN_MM, y);
    y += LINE_HEIGHT_MM * line.length;
    if (item.notes) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      const noteLine = doc.splitTextToSize(`↳ ${item.notes}`, contentWidth - 2);
      doc.text(noteLine, MARGIN_MM + 2, y);
      y += LINE_HEIGHT_MM * noteLine.length;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
    }
  }

  doc.setLineWidth(0.2);
  doc.line(MARGIN_MM, y, TICKET_WIDTH_MM - MARGIN_MM, y);
  y += LINE_HEIGHT_MM - 1;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const addressLine = doc.splitTextToSize(`Adrès: ${order.delivery_address}`, contentWidth);
  doc.text(addressLine, MARGIN_MM, y);
  y += LINE_HEIGHT_MM * addressLine.length;

  if (order.contact_phone) {
    doc.text(`Tel: ${order.contact_phone}`, MARGIN_MM, y);
    y += LINE_HEIGHT_MM;
  }

  if (order.delivery_notes) {
    doc.setFont("helvetica", "italic");
    const noteLine = doc.splitTextToSize(`Nòt: ${order.delivery_notes}`, contentWidth);
    doc.text(noteLine, MARGIN_MM, y);
  }

  // autoPrint() flags the PDF to invoke the browser's print dialog as soon
  // as it opens, so kitchen staff get one click -> printed ticket instead
  // of click -> download -> open -> print.
  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}

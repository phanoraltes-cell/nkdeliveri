import type { StatusTone } from "@/components/dashboard/status-badge";

/**
 * "Komand Health" — a value computed live by get_orders_admin (never stored
 * on orders.status, see docs/archive/audits/KOMAND_ADMIN_AUDIT.md §5/§7). Kreyòl labels +
 * badge tones shared between the list table and the detail dialog so the
 * two never drift.
 */
export const KOMAND_HEALTH_LABEL: Record<string, string> = {
  assistance_required: "Asistans nesesè",
  blocked: "Bloke",
  incomplete: "Enkonplè",
  complete: "Konplete",
  cancelled: "Anile",
  refunded: "Ranbouse",
  en_cours: "An kou",
};

export const KOMAND_HEALTH_TONE: Record<string, StatusTone> = {
  assistance_required: "bad",
  blocked: "warn",
  incomplete: "info",
  complete: "good",
  cancelled: "neutral",
  refunded: "neutral",
  en_cours: "info",
};

/** Filter tabs on the Komand list — order matters (most urgent first). */
export const KOMAND_HEALTH_FILTERS = [
  "assistance_required",
  "blocked",
  "incomplete",
  "en_cours",
  "complete",
  "cancelled",
  "refunded",
] as const;

export const KOMAND_ASSISTANCE_LABEL: Record<string, string> = {
  none: "Pa gen",
  required: "Nesesè",
  in_progress: "An kou",
  resolved: "Rezoud",
};

export const KOMAND_ASSISTANCE_TONE: Record<string, StatusTone> = {
  none: "neutral",
  required: "bad",
  in_progress: "warn",
  resolved: "good",
};

/** Generic status label fallback for payment/delivery/cash-confirmation/refund text columns — Kreyòl, reused across the detail dialog's small status pills. */
export const KOMAND_SUBSTATUS_LABEL: Record<string, string> = {
  // payment_status
  pending: "An atant",
  awaiting_proof: "An atant prèv",
  under_review: "Ap revize",
  paid: "Peye",
  failed: "Echwe",
  refunded: "Ranbouse",
  // delivery_status
  assigned: "Asiyen",
  picked_up: "An wout",
  delivered: "Livre",
  // cash_confirmation_status
  customer_confirmed: "Kliyan konfime",
  driver_confirmed: "Livrè konfime",
  validated: "Valide",
  disputed: "Kontete",
  // refund_status
  requested: "Mande",
  approved: "Apwouve",
  completed: "Konplete",
};

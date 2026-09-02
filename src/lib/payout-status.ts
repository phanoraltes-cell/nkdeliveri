import type { StatusTone } from "@/components/dashboard/status-badge";

/** Kreyòl label/tone for a `payouts.status` value (a single manual-payment record). */
export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  requested: "Demann voye",
  pending: "An tretman",
  paid: "Peye",
  confirmed: "Konfime",
  disputed: "Kontete",
  resolved: "Rezoud",
  failed: "Echwe",
};
export const PAYOUT_STATUS_TONE: Record<string, StatusTone> = {
  requested: "warn",
  pending: "warn",
  paid: "info",
  confirmed: "good",
  disputed: "bad",
  resolved: "neutral",
  failed: "bad",
};

/** Kreyòl label for the `resolution` sub-field, shown alongside "Rezoud". */
export const PAYOUT_RESOLUTION_LABEL: Record<string, string> = {
  confirmed: "Konfime pa admin",
  reversed: "Ranvèse pa admin",
};

/**
 * Kreyòl label/tone for a commission's derived status (never stored —
 * computed live from whether/how its linked payout has progressed, see
 * get_restaurant_commissions_secure/get_driver_commissions_secure).
 * 'paid'/'confirmed'/'disputed'/'resolved' mirror the linked payout's own
 * status exactly (by construction, not copied), shown only once the
 * commission is *fully* covered — 'available' means nothing paid yet,
 * 'partially_paid' means some but not all of it has been paid out (a
 * commission can now be covered across several payouts), 'reversed' is a
 * refund clawback entry.
 */
export const COMMISSION_STATUS_LABEL: Record<string, string> = {
  available: "Disponib",
  partially_paid: "Peye pasyèlman",
  paid: "Peye",
  confirmed: "Konfime",
  disputed: "Kontete",
  resolved: "Rezoud",
  reversed: "Ranvèse",
};
export const COMMISSION_STATUS_TONE: Record<string, StatusTone> = {
  available: "warn",
  partially_paid: "warn",
  paid: "info",
  confirmed: "good",
  disputed: "bad",
  resolved: "neutral",
  reversed: "bad",
};

/** Kreyòl label/tone for a beneficiary's derived list-row status (Phase 4's admin table). */
export const WALLET_STATUS_LABEL: Record<string, string> = {
  pending: "An atant",
  paid: "Peye",
  disputed: "Kontete",
  settled: "Regle",
};
export const WALLET_STATUS_TONE: Record<string, StatusTone> = {
  pending: "warn",
  paid: "info",
  disputed: "bad",
  settled: "neutral",
};

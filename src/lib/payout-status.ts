import type { StatusTone } from "@/components/dashboard/status-badge";

/** Kreyòl label/tone for a `payouts.status` value (a single manual-payment record). */
export const PAYOUT_STATUS_LABEL: Record<string, string> = {
  paid: "Peye",
  confirmed: "Konfime",
  disputed: "Kontete",
  resolved: "Rezoud",
};
export const PAYOUT_STATUS_TONE: Record<string, StatusTone> = {
  paid: "info",
  confirmed: "good",
  disputed: "bad",
  resolved: "neutral",
};

/** Kreyòl label for the `resolution` sub-field, shown alongside "Rezoud". */
export const PAYOUT_RESOLUTION_LABEL: Record<string, string> = {
  confirmed: "Konfime pa admin",
  reversed: "Ranvèse pa admin",
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

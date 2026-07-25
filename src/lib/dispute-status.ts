import type { StatusTone } from "@/components/dashboard/status-badge";

/** Statuses a dispute can be in — terminal ones lock the message thread (see DisputeThread). */
export const DISPUTE_TERMINAL_STATUSES = new Set(["resolved", "rejected"]);

/** Kreyòl label/tone for each `disputes.status` value — shared by the driver/restaurant/admin dispute pages. */
export const DISPUTE_STATUS_LABEL: Record<string, string> = {
  open: "Louvri",
  in_review: "An analiz",
  action_required: "Aksyon nesesè",
  resolved: "Rezoud",
  rejected: "Rejte",
  escalated: "Eskalade",
};
export const DISPUTE_STATUS_TONE: Record<string, StatusTone> = {
  open: "warn",
  in_review: "info",
  action_required: "warn",
  resolved: "good",
  rejected: "bad",
  escalated: "bad",
};

/** Kreyòl label for each `disputes.category_group` value. */
export const DISPUTE_CATEGORY_GROUP_LABEL: Record<string, string> = {
  payment: "Peman",
  delivery: "Livrezon",
  restaurant: "Restoran",
  driver: "Livrè",
};

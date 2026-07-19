import type { StatusTone } from "@/components/dashboard/status-badge";

/** Kreyòl label/tone for each `disputes.status` value — shared by the driver/restaurant/admin dispute pages. */
export const DISPUTE_STATUS_LABEL: Record<string, string> = { open: "Louvri", resolved: "Rezoud" };
export const DISPUTE_STATUS_TONE: Record<string, StatusTone> = { open: "warn", resolved: "good" };

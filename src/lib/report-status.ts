import type { StatusTone } from "@/components/dashboard/status-badge";

/**
 * TACH 1 (SIYALMAN) — Kreyòl label/tone pou chak `reports.status`/
 * `reports.resolution`/`reason_code`, ak lis rezon fiks pa sib (menm lis
 * REYÈL egzat ki verifye sou sèvè a nan create_report_secure — pa envante
 * okenn nouvo rezon isit la san modifye SQL la tou).
 */
export const REPORT_STATUS_LABEL: Record<string, string> = {
  open: "Resevwa",
  reviewing: "Anba etid",
  resolved: "Rezoud",
  rejected: "Rejte",
};
export const REPORT_STATUS_TONE: Record<string, StatusTone> = {
  open: "warn",
  reviewing: "info",
  resolved: "good",
  rejected: "bad",
};
export const REPORT_TERMINAL_STATUSES = new Set(["resolved", "rejected"]);

export const REPORT_RESOLUTION_LABEL: Record<string, string> = {
  none: "Okenn",
  warning: "Avètisman voye",
  refund: "Ranbousman (total)",
  partial_refund: "Ranbousman (pasyèl)",
  suspension: "Sispann",
};

export const REPORT_TARGET_LABEL: Record<string, string> = {
  courier: "Livrè",
  restaurant: "Restoran",
};

export const REPORT_REASON_CODES: Record<
  "restaurant" | "courier",
  { value: string; label: string }[]
> = {
  restaurant: [
    { value: "food_not_good", label: "Manje a pa t bon" },
    { value: "incomplete_order", label: "Kòmand pa konplè" },
    { value: "wrong_dish", label: "Move pla" },
    { value: "cold_food", label: "Manje frèt" },
    { value: "hygiene_issue", label: "Pwoblèm ijyèn" },
    { value: "long_prep_delay", label: "Anpil reta nan preparasyon" },
    { value: "incorrect_price", label: "Pri pa kòrèk" },
  ],
  courier: [
    { value: "long_delay", label: "Gwo reta" },
    { value: "never_arrived", label: "Livrezon pa janm rive" },
    { value: "bad_behavior", label: "Move konpòtman" },
    { value: "damaged_order", label: "Kòmand rive gaye oswa domaje" },
    { value: "extra_money_demanded", label: "Li mande lajan anplis" },
    { value: "wrong_address", label: "Li pa respekte adrès la" },
  ],
};

export function reportReasonLabel(targetType: string, reasonCode: string): string {
  const list = REPORT_REASON_CODES[targetType as "restaurant" | "courier"] ?? [];
  return list.find((r) => r.value === reasonCode)?.label ?? reasonCode;
}

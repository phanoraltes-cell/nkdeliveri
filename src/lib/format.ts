import { AMOUNT_UNAVAILABLE, reportInvalidAmount, toAmount } from "@/lib/money";

/**
 * Fòmate yon montan an HTG.
 *
 * SE ISIT LA GAD SANTRAL LA AP TRAVAY. Prèske chak montan nan aplikasyon
 * an pase pa fonksyon sa a anvan yon moun wè l, donk se sèl kote nou
 * bezwen pou « NaN HTG » pa janm parèt ankò — kèlkeswa ki paj, ki rekèt,
 * oswa ki kolòn ki kase.
 *
 * Yon montan ki pa valab bay `AMOUNT_UNAVAILABLE` (« — »), PA « 0 HTG ».
 * Zewo se yon montan reyèl: montre l lè li fo ta di yon livrè li pa touche
 * anyen, oswa di yon kliyan kòmand li gratis. « — » di laverite: nou pa
 * konnen.
 *
 * Chak ka siyale nan konsòl la ak nan Sentry (yon sèl fwa pa kontèks), pou
 * gad la pa tounen yon kachèt: nou wè « — » sou ekran an EPI nou resevwa
 * yon alèt pou n ranje sous la.
 *
 * Kalite a se `number | null | undefined` — pa `unknown` — pou TypeScript
 * kontinye rejte yon objè oswa yon tab pandan konpilasyon.
 */
export function formatHTG(amount: number | null | undefined): string {
  const value = toAmount(amount);
  if (value === null) {
    reportInvalidAmount("formatHTG", amount);
    return AMOUNT_UNAVAILABLE;
  }
  return `${value.toLocaleString("fr-HT", { maximumFractionDigits: 0 })} HTG`;
}

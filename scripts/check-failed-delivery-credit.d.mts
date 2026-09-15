/** Deklarasyon tip pou check-failed-delivery-credit.mjs. */

/**
 * Chak vyolasyon se yon fraz konplè ki di ki fichye ak sa ki kase — pa yon
 * kòd. Lis vid = envaryan an kenbe: yon kòmand ki pase pa `delivery_failed`
 * epi apre pa `delivered` bay YON SÈL kredi livrè.
 */
export function findFailedDeliveryCreditViolations(dir?: string): string[];

/** Ekri vyolasyon yo epi retounen kantite a (0 = tout bon). */
export function reportFailedDeliveryCreditViolations(): number;

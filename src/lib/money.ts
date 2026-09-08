/**
 * GAD SANTRAL POU MONTAN LAJAN.
 *
 * Poukisa fichye sa a egziste: bug `useDeliveryFee` la (`Number(undefined)`
 * → `NaN` → paj peman an montre « Total: NaN HTG » ak bouton konfime a
 * aktif) pa t yon aksidan izole. Se yon FANMI defo ki repete chak kote yon
 * montan soti nan yon sous ki pa garanti — repons Supabase, `localStorage`,
 * yon fòm, yon kolòn ki ka NULL — epi ki antre dirèkteman nan `Number()`
 * oswa nan yon adisyon.
 *
 * Twa pyèj ki fè defo sa yo envizib:
 *
 *   1. `Number(undefined)` bay `NaN`, li pa leve okenn erè.
 *   2. `NaN` kontamine: `NaN + 100` se `NaN`. Yon sèl move ranje nan yon
 *      sòm kraze tout total la.
 *   3. `??` PA kenbe `NaN`. `Number(x) ?? 0` bay `NaN`, pa `0` — se yon
 *      erè ki parèt korèk lè w li l.
 *
 * Epi de pyèj nan "solisyon" ki pi fasil la:
 *
 *   4. `Number(x) || 0` fè yon montan ki manke tounen **0 HTG**. Sa a se
 *      pi mal pase NaN: NaN parèt kase, men « 0 HTG » parèt vre. Yon
 *      livrè ki wè « Gen ou jodi a: 0 HTG » pandan li fè 6 livrezon ap
 *      kwè li pa touche anyen.
 *   5. `toLocaleString` sou yon `string` mache san erè men li pa fòmate —
 *      "1500.00" ap parèt tèl kèl.
 *
 * Règ la isit la: **yon montan ki pa yon nonb fini pa yon montan.** Nou
 * pa devine, nou pa mete 0. Nou di li pa disponib, epi nou siyale l pou l
 * ka ranje — paske yon montan ki manke se toujou yon bug, pa yon eta
 * nòmal.
 *
 * Sa fichye sa a PA ye: li pa yon validasyon sekirite. Sèvè a
 * (`create_order_secure`, `request_withdrawal_secure`, elatriye) rekalkile
 * chak montan pou kont li. Sa a se pou nou pa AFICHE ni ANREJISTRE yon
 * chif ki pa vle di anyen.
 */

/** Sa nou montre lè yon montan pa disponib. Jamè « 0 », jamè « NaN ». */
export const AMOUNT_UNAVAILABLE = "—";

/** Vre sèlman pou yon `number` ki fini (donk ni NaN, ni Infinity, ni yon string). */
export function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Konvèti yon valè ki soti nan yon sous ki pa garanti an yon montan.
 * Retounen `null` — pa `NaN`, pa `0` — lè valè a pa yon montan.
 *
 * Nou aksepte `string` paske PostgREST retounen kolòn `numeric` yo kòm
 * string (se rezon ki fè gen `Number()` toupatou nan kòd la). Nou REFIZE
 * `boolean`, `[]` ak `{}` eksprè: `Number(true)` bay 1 epi `Number([])`
 * bay 0, de repons ki ta envante lajan ki pa egziste.
 */
export function toAmount(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Menm bagay ak `toAmount`, men ak yon valè ranplasman EKSPLISIT.
 *
 * Sèvi ak li sèlman lè zewo (oswa lòt valè a) se reyèlman bon repons lan —
 * pa egzanp yon panye vid. Si ou pa sèten, sèvi ak `toAmount` epi montre
 * `AMOUNT_UNAVAILABLE`: yon « 0 HTG » ki fo se yon manti, pa yon defo.
 */
export function toAmountOr(value: unknown, fallback: number): number {
  return toAmount(value) ?? fallback;
}

/**
 * Menm bagay ak `toAmount`, men li **LEVE YON ERÈ** olye li retounen
 * `null`.
 *
 * Sèvi ak li nan yon kalkil ki DWE bay yon repons — yon frè pou n voye bay
 * yon pwovidè, yon montan pou n anrejistre. Règ la: yon frè ki disparèt an
 * silans se lajan ki pèdi. Pi bon yon operasyon ki echwe ak yon mesaj klè
 * pase yon operasyon ki reyisi ak yon chif ki fo.
 *
 * `context` a antre nan mesaj la — se li ki di kote pwoblèm nan ye lè erè
 * a rive nan Sentry.
 */
export function requireAmount(value: unknown, context: string): number {
  const amount = toAmount(value);
  if (amount === null) {
    reportInvalidAmount(context, value);
    throw new Error(
      `Montan an pa valab (${context}). Nou pa ka kontinye ak yon chif nou pa sèten.`,
    );
  }
  return amount;
}

/**
 * Yon montan ki dwe pozitif oswa zewo — yon pri, yon frè, yon retrè.
 *
 * Yon `available_delta` nan liv la ka negatif (se konsa yon debi ekri), yon
 * balans ka tonbe negatif nan yon ka rekonsilyasyon. Se poutèt sa nou PA
 * mete « pa negatif » nan `toAmount` li menm — chak kote di li menm si
 * negatif gen sans lakay li.
 */
export function isValidNonNegativeAmount(value: unknown): value is number {
  const amount = toAmount(value);
  return amount !== null && amount >= 0;
}

/**
 * Sòm ki pa janm bay `NaN` an silans.
 *
 * Si YON SÈL eleman pa yon montan valab, tout sòm nan tounen `null`. Sa a
 * se yon chwa: yon total ki manke yon ranje se yon total ki fo, epi yon
 * total ki fo sou yon paj gen lajan se pi danjere pase yon total ki
 * absan. Moun nan wè « — » epi li konnen gen yon pwoblèm.
 */
export function sumAmounts(values: Iterable<unknown>): number | null {
  let total = 0;
  for (const value of values) {
    const amount = toAmount(value);
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

// Nou siyale chak kontèks YON SÈL fwa. San sa, yon lis ak 200 ranje ki
// gen yon kolòn kase ta voye 200 evènman Sentry pou menm bug la.
const reported = new Set<string>();

/**
 * Siyale yon montan ki pa valab: konsòl la (devlopè) plis Sentry
 * (pwodiksyon). Se sa ki fè diferans ant yon gad ki KACHE yon bug ak yon
 * gad ki EKSPOZE l — san sa a, ranplase NaN ak « — » ta senpleman fè defo
 * a pi difisil pou wè.
 *
 * Menm modèl chajman parese ak `rpc-errors.ts` ak `__root.tsx`: Sentry
 * chaje sèlman nan navigatè a, epi li pa janm bloke afichaj la.
 */
export function reportInvalidAmount(context: string, value: unknown): void {
  if (reported.has(context)) return;
  reported.add(context);

  const message = `[money] montan ki pa valab nan ${context}: ${describe(value)}`;
  console.error(message);

  if (typeof window === "undefined") return;
  void import("@/lib/sentry-browser")
    .then((m) => m.captureExceptionClient(new Error(message)))
    .catch(() => {
      // Sentry pa obligatwa pou paj la mache — konsòl la deja gen tras la.
    });
}

/** Sèlman pou mesaj erè a — jamè pou yon kalkil. */
function describe(value: unknown): string {
  if (typeof value === "number") return Number.isNaN(value) ? "NaN" : String(value);
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string ${JSON.stringify(value.slice(0, 40))}`;
  return typeof value;
}

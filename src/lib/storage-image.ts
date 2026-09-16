/**
 * SÈVI YON IMAJ STORAGE NAN TAY LI AFICHE A, PA NAN TAY LI TE TELECHAJE A.
 *
 * ---------------------------------------------------------------------------
 * PWOBLÈM NAN, MEZIRE
 *
 * Sou dakèy pwodiksyon an, yon kouvèti restoran fè **1 803 Ko** epi li
 * afiche nan yon kare 280x160. Rekèt odit
 * (scripts/sql/audit/11-storage-oversized-images.sql) bay:
 *
 *   17 objè nan Storage, 6 013 Ko total
 *   3 objè depase 300 Ko -> 4 756 Ko, ki se 79% tout pwa a
 *
 * Kliyan nou yo sou done mobil yo peye. Telechaje 1,8 Mo pou montre yon
 * vinyèt koute lajan pou anyen.
 *
 * ---------------------------------------------------------------------------
 * SOLISYON AN: YON CHANJMAN URL, PA YON RETELECHAJMAN
 *
 * Transfòmasyon imaj sou demann AKTIVE sou pwojè a — teste sou vrè imaj la:
 *
 *   /storage/v1/object/public/…            1 846 042 octè
 *   /storage/v1/render/image/public/…         12 778 octè
 *       ?width=280&height=160&resize=cover&quality=75
 *   menm bagay ak `Accept: image/webp`        13 056 octè
 *
 * Fichye orijinal la pa touche. Okenn migrasyon done, okenn pèt.
 *
 * ---------------------------------------------------------------------------
 * POUKISA 1x EPI PA 2x
 *
 * Mezire sou menm imaj la (sòti WebP):
 *
 *   280 px, quality 75   ->  13,7 Ko
 *   560 px, quality 75   ->  42,7 Ko
 *   560 px, quality 60   ->  36,6 Ko
 *   560 px, quality 50   ->  33,0 Ko
 *
 * 2x koute twa fwa plis menm ak yon kalite pi ba. Sou yon telefòn ki gen yon
 * ekran dans, 1x pi dous — men 13,7 Ko kont 1 803 Ko rete yon faktè 131, epi
 * chwa a se done kliyan an ki peye. Yon apelan ki bezwen plis netete ka
 * mande `dpr: 2` eksplisitman.
 *
 * ---------------------------------------------------------------------------
 * SA LI PA TOUCHE
 *
 *   * `public/kategori/*.webp` — fichye estatik nan depo a, Vercel ki sèvi
 *     yo. Endpoint Supabase la pa wè yo; yo mande yon vrè redimansyonman.
 *   * Bikèt PRIVE (`/object/sign/`, `/object/authenticated/`) —
 *     `driver-documents` an patikilye. De rezon: endpoint piblik la pa
 *     aplike, EPI redwi yon pyès idantite yon admin dwe li ta yon fòt.
 *   * Nenpòt URL ki pa soti nan Storage (lyen ekstèn, chemen estatik).
 */

/** Sèl fòm URL nou transfòme: yon objè PIBLIK nan Storage. */
const PUBLIC_OBJECT_SEGMENT = "/storage/v1/object/public/";
const RENDER_SEGMENT = "/storage/v1/render/image/public/";

export type StorageImageOptions = {
  /** Lajè CSS eleman an (px). San li, okenn transfòmasyon pa fèt. */
  width?: number;
  height?: number;
  /** 1 pa defo — wè nòt la pi wo sou pri 2x la. */
  dpr?: number;
  /** 75 pa defo. */
  quality?: number;
  resize?: "cover" | "contain" | "fill";
};

/**
 * Retounen yon URL ki sèvi imaj la nan tay li bezwen an.
 *
 * Li retounen `src` jan li ye a — san okenn chanjman — lè li pa yon objè
 * piblik Storage, oswa lè pa gen dimansyon. Konsa yon apelan ka toujou pase
 * pa li san li pa bezwen konnen ki kalite URL li genyen.
 */
export function storageImageUrl(
  src: string | null | undefined,
  opts: StorageImageOptions = {},
): string | null | undefined {
  if (!src) return src;

  const idx = src.indexOf(PUBLIC_OBJECT_SEGMENT);
  if (idx === -1) return src;

  const { width, height, dpr = 1, quality = 75, resize = "cover" } = opts;
  if (!width && !height) return src;

  // Kenbe nenpòt keri ki deja la (egz. `?t=` kont kachèt) epi ajoute pa nou
  // yo — pa ranplase yo.
  const [base, existingQuery] = src.split("?", 2);
  const params = new URLSearchParams(existingQuery ?? "");

  // Ranpli nan nonm antye: yon `width=280.5` se yon 400 Bad Request.
  if (width) params.set("width", String(Math.round(width * dpr)));
  if (height) params.set("height", String(Math.round(height * dpr)));
  params.set("resize", resize);
  params.set("quality", String(quality));

  return base.replace(PUBLIC_OBJECT_SEGMENT, RENDER_SEGMENT) + "?" + params.toString();
}

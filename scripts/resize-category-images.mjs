import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/**
 * REDIMANSYONE IMAJ KATEGORI YO NAN TAY YO AFICHE A.
 *
 * ---------------------------------------------------------------------------
 * POUKISA
 *
 * `kategori-pla-section.tsx` afiche chak imaj nan yon bwat `aspect-square`
 * ki fè 190 px maksimòm sou biwo (`md:w-[190px]`), ak `object-cover` epi
 * atribi `width={220} height={220}`. Sous yo ale jiska **3642x3642**:
 *
 *   3642x3642  541 Ko        714x952   100 Ko
 *   2048x2048  758 Ko        660x660   113 Ko
 *   1600x1600  757 Ko        512x512    92 Ko
 *   1440x1080  237 Ko        1280x720  134 Ko
 *   1400x934   240 Ko        1332x1332 349 Ko
 *                            ─────────────────
 *                            10 fichye, 3 321 Ko
 *
 * Kat nan yo `loading="eager"` — 696 Ko sou premye ekran an. Kliyan nou yo
 * sou done mobil yo peye.
 *
 * Endpoint transfòmasyon Supabase la PA ka ede: fichye sa yo estatik nan
 * depo a, se Vercel ki sèvi yo. Donk nou redimansyone yo yon fwa pou tout.
 *
 * ---------------------------------------------------------------------------
 * POUKISA YON KARE, EPI POUKISA `attention`
 *
 * Bwat la `aspect-square` ak `object-cover`: navigatè a DEJA koupe imaj la
 * an kare. Nou fè menm koup la, jis yon sèl fwa olye chak vizit. Rezilta
 * vizyèl la idantik.
 *
 * `position: "attention"` kite sharp chwazi zòn ki gen plis detay la olye
 * sant jeyometrik la — sou yon foto manje, sant lan ka tonbe sou yon bò
 * asyèt vid.
 *
 * ---------------------------------------------------------------------------
 * ORIJINAL YO
 *
 * Script la EKRASE fichye yo sou plas. Orijinal yo rete nan istwa git —
 * `git show <komit>^:public/kategori/<non>` si yon jou yon moun bezwen yo.
 * Se poutèt sa li dwe kouri nan yon dosye travay pwòp.
 *
 * ---------------------------------------------------------------------------
 * ITILIZASYON
 *
 *   node scripts/resize-category-images.mjs --dry   # mezire, pa ekri anyen
 *   node scripts/resize-category-images.mjs         # ekri
 */

const DIR = "public/kategori";
/** 220 deklare x 2 pou ekran dans. Bwat la pa janm depase 190 px CSS. */
const SIZE = 440;
const QUALITY = 75;

const dry = process.argv.includes("--dry");

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".webp"))
  .sort();

if (files.length === 0) {
  console.error(`Okenn .webp nan ${DIR}`);
  process.exit(1);
}

let before = 0;
let problems = 0;
let after = 0;

for (const name of files) {
  const path = join(DIR, name);
  const original = readFileSync(path);
  const meta = await sharp(original).metadata();

  // Yon imaj ki deja nan bon tay la: nou kite l. Sa fè script la
  // idanpotan — relanse l pa degrade imaj yo yon dezyèm fwa.
  if (meta.width <= SIZE && meta.height <= SIZE) {
    console.log(
      `  = ${name.slice(0, 44).padEnd(44)} ${meta.width}x${meta.height}  ${(original.length / 1024).toFixed(0)} Ko  (deja bon)`,
    );
    before += original.length;
    after += original.length;
    continue;
  }

  const out = await sharp(original)
    .resize(SIZE, SIZE, { fit: "cover", position: "attention" })
    .webp({ quality: QUALITY })
    .toBuffer();

  // GAD SOU KALITE. Yon fichye ki vin TWÒ piti ka vle di de bagay diferan:
  // yon sous ki te deja plat (bon), oswa yon koup ki tonbe sou yon zòn ini
  // epi ki jete sijè a (move). Entropi separe yo — li mezire konbyen
  // enfòmasyon ki nan imaj la.
  //
  // Egzanp reyèl: haiti-10 desann a 12 Ko pandan lòt yo bay 25-46 Ko. Sa te
  // parèt sispèk. Entropi sous la se 6,15 epi apre se 6,17 — donk imaj la
  // te plat depi nan konmansman, anyen pa pèdi. haiti-17: 7,72 -> 7,66.
  //
  // Nou pa vle konte sou yon moun k ap gade 10 imaj youn apre lòt.
  const entropyBefore = (await sharp(original).stats()).entropy;
  const entropyAfter = (await sharp(out).stats()).entropy;
  const drop = entropyBefore > 0 ? (entropyBefore - entropyAfter) / entropyBefore : 0;
  const warn = drop > 0.15 ? `  ⚠ entropi tonbe ${(drop * 100).toFixed(0)}% — gade imaj la` : "";
  if (warn) problems++;

  before += original.length;
  after += out.length;

  console.log(
    `  ${dry ? "?" : "→"} ${name.slice(0, 44).padEnd(44)} ` +
      `${meta.width}x${meta.height} ${(original.length / 1024).toFixed(0)} Ko` +
      `  ->  ${SIZE}x${SIZE} ${(out.length / 1024).toFixed(0)} Ko` +
      `  [entropi ${entropyBefore.toFixed(2)}→${entropyAfter.toFixed(2)}]${warn}`,
  );

  if (!dry) writeFileSync(path, out);
}

const saved = before - after;
console.log("");
console.log(`  anvan : ${(before / 1024).toFixed(0)} Ko`);
console.log(`  apre  : ${(after / 1024).toFixed(0)} Ko`);
console.log(
  `  ekonomi: ${(saved / 1024).toFixed(0)} Ko (${((saved / before) * 100).toFixed(0)}%)` +
    (dry ? "   [--dry: anyen pa ekri]" : ""),
);

// Videyo a pa konsène: `haiti-tourisme.mp4` (11,2 Mo) gen `preload="none"`
// epi eleman `<video>` la pa menm monte anvan yon moun klike — zewo octè
// anvan entèraksyon. Wè haiti-video-popup.tsx:40-41.
const mp4 = join(DIR, "haiti-tourisme.mp4");
try {
  console.log(
    `\n  (videyo a: ${(statSync(mp4).size / 1024 / 1024).toFixed(1)} Mo, preload="none" — pa touche)`,
  );
} catch {
  /* pa la, pa grav */
}

if (problems > 0) {
  console.error(`\n  ⚠ ${problems} imaj kote entropi tonbe anpil — gade yo anvan ou komite.`);
  process.exit(1);
}

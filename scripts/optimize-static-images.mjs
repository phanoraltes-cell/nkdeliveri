import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import sharp from "sharp";

/**
 * OPTIMIZE GWO IMAJ ESTATIK `public/` YO.
 *
 * ---------------------------------------------------------------------------
 * POUKISA, EPI KIYES KI PEYE
 *
 *   scooter.png         1 391 Ko  1448x1086  <img> senp, loading="lazy"
 *   bg-hero-v2.png      2 387 Ko  1024x1365  repli <picture>
 *   hero-livreur-v2.png 1 224 Ko  1920x800   repli <picture>
 *   app-mockup-v3.png     365 Ko  348x718    <img> senp, loading="lazy"
 *
 * `scooter.png` se sa ki pi grav: li PA nan yon <picture>, se yon
 * `<img src>` senp (newsletter-section.tsx:89-95). Donk CHAK vizite ki
 * desann rive nan seksyon newsletter la telechaje 1 391 Ko pou yon bwat ki
 * fe apepre 460 px. Li te chape nan odit A6 a paske li anba pli a.
 *
 * De repli <picture> yo, se vre, 97% moun pa telechaje yo. Men se moun ki
 * gen aparey ki pi ansyen yo — sa ki pa sipote WebP — ki pran yo. Sou mache
 * nou an se egzakteman moun ki pi mal kapab peye 2,4 Mo. Yon repli dwe pi
 * leje pase chemen prensipal la, pa 16 fwa pi lou.
 *
 * ---------------------------------------------------------------------------
 * TWA FOTO OPAK -> JPEG
 *
 * PNG se yon move foma pou yon foto. Twa nan kat fichye yo OPAK
 * (`stats().isOpaque` = true), donk kanal alfa a pa sevi anyen:
 *
 *   scooter         -> JPEG w=1120 q80   1 391 Ko -> 78 Ko   entropi 5.27->5.13
 *   bg-hero-v2      -> JPEG q82          2 387 Ko -> 127 Ko  entropi 7.71->7.69
 *   hero-livreur-v2 -> JPEG q82          1 224 Ko -> 89 Ko   entropi 7.42->7.41
 *
 * JPEG epi pa WebP: `scooter` se yon <img> senp san repli, epi de lot yo SE
 * repli a pou navigate ki pa gen WebP. Nan toude ka yo foma a dwe mache
 * tout kote. Sou `scooter` yon WebP q80 ta bay 54 Ko olye 78 — 24 Ko.
 * Sa pa vo yon dezyem fichye ak yon <picture> le nou deja pran 94% la.
 *
 * EFE SEKONDE KI ENPOTAN: yon fwa repli bg-hero-v2 a desann a 127 Ko, li vin
 * PI LEJE pase jimo WebP li a (145 Ko). Sa vle di 97% moun yo t ap resevwa
 * pi move zafe a. Donk nou reankode WebP la tou (q82 -> 85 Ko). Nou tcheke
 * hero-livreur-v2.webp menm jan: 50 Ko deja, q82 ta bay 52 — nou pa touche l.
 *
 * ---------------------------------------------------------------------------
 * APP-MOCKUP: LI GEN VRE TRANSPARANS, DONK LI PA SENP
 *
 * `app-mockup-v3.png` gen yon vre kanal alfa (`isOpaque` = false) — silwet
 * telefon nan pote `drop-shadow` CSS la. Donk li pa ka vin JPEG.
 *
 * ATANSYON SOU SHARP: `png({ effort: 10 })` PA yon reglaj konpresyon san
 * pet. Nan sharp 0.35 bay `effort` limenm ALIME kantifikasyon palet la (sof
 * si ou ekri `palette: false`). Mezire sou raw pixel yo:
 *
 *   png({compressionLevel:9})              336 Ko   0 pixel chanje
 *   png({compressionLevel:9, effort:10})   105 Ko   456 201 octe chanje (!)
 *   png({palette:true, colours:256})       110 Ko   menm bagay
 *
 * Donk "105 Ko san pet" pa t janm egziste — se te palet la tout tan.
 * Konparezon reyel la, sou pixel opak yo ak sou kanal alfa a:
 *
 *   png san pet         336 Ko   0 px chanje           alfa entak
 *   png palet 256       110 Ko   217 386 px (maks 51)  alfa kraze sou 3 885 px
 *   webp lossless       193 Ko   0 px chanje           alfa entak
 *   webp q90             51 Ko   185 838 px (maks 34)  ALFA ENTAK (0 px)
 *
 * WebP q90 bat palet PNG sou TOUT liy: 51 Ko olye 110, epi li kenbe alfa a
 * egzak pandan palet la ap kraze l sou 3 885 pixel — sa ta bay yon lizye
 * sal sou kwen wonn telefon nan ak sou lonbraj la.
 *
 * Donk app-mockup vin yon <picture>, menm model ak de hero yo:
 *   - .webp q90    (51 Ko)  -> sa 97%+ moun resevwa
 *   - .png san pet (336 Ko) -> repli, PI PITI pase 365 Ko jodi a
 *
 * Yon repli palet 110 Ko ta ekonomize 226 Ko ANKO sou ansyen aparey yo, men
 * li ta voye yon imaj degrade bay moun sa yo. Nou pa fe echanj sa a sou yon
 * zafe mak san yon moun gade l. Se yon swit posib, pa yon bagay nou pran la.
 *
 * ---------------------------------------------------------------------------
 * POUKISA CHAK FICHYE CHANJE NON — SE PA YON KAPRIS
 *
 * Tout kat fichye sa yo nan `globIgnores` vite.config.ts la, donk yo PA nan
 * manifes prekach revizyone a. Sel bagay ki kache yo se reg `CacheFirst`
 * "static-assets" nan src/sw.ts:26-27, ki PA konnen anyen sou revizyon
 * kontni epi ki kenbe 30 jou. Yon fichye ki chanje kontni men ki kenbe menm
 * non an sevi ansyen octe yo pandan 30 jou — se egzakteman bug
 * "imaj disparet sou mobil" vite.config.ts la dokimante a.
 *
 * Donk chak soti pran yon non ki pa janm egziste (verifye ak `git log --all
 * -- <chemen>`), ki garanti yon MISS kelkeswa eta kach kliyan an:
 *
 *   scooter.png         -> scooter-v2.jpg   PA `scooter.jpg`: sa a te yon
 *                                           VRE fichye (61 Ko, yon LOT
 *                                           foto), efase 2026-08-31 — 15
 *                                           jou, anndan fenet 30 jou a.
 *   bg-hero-v2.png      -> bg-hero-v2.jpg       non lib (0 komit)
 *   hero-livreur-v2.png -> hero-livreur-v2.jpg  non lib (0 komit)
 *   app-mockup-v3.png   -> app-mockup-v4.{webp,png}  menm konvansyon ak
 *                                           v2 -> v3.
 *
 * ---------------------------------------------------------------------------
 * ORIJINAL YO
 *
 * Script la efase sous la. Orijinal yo rete nan istwa git —
 * `git show <komit>^:public/<non>`.
 *
 * ---------------------------------------------------------------------------
 * ITILIZASYON
 *
 *   node scripts/optimize-static-images.mjs --dry   # mezire, pa ekri anyen
 *   node scripts/optimize-static-images.mjs         # ekri
 */

const JOBS = [
  {
    from: "public/scooter.png",
    outputs: [
      {
        to: "public/scooter-v2.jpg",
        run: (s) =>
          s.resize(1120, null, { withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }),
        note: "<img> senp — chak vizite ki desann telechaje l",
      },
    ],
  },
  {
    from: "public/bg-hero-v2.png",
    outputs: [
      {
        // WEBP LA TOU. Li te 145 Ko — PI LOU pase repli JPEG 127 Ko a nou
        // fenk fe a, donk 97% moun yo t ap resevwa pi move zafe a. Li te
        // ankode twop: q82 bay 85 Ko ak yon chit entropi 0,1%. Sou yon imaj
        // ki gen `fetchPriority="high"` (se LCP mobil la) se 60 Ko direk sou
        // chemen prensipal la.
        //
        // Non an pa chanje isit la, epi sa KOREK: kontrèman ak kat lot yo,
        // bg-hero-v2.webp PA nan globIgnores — li nan manifes prekach
        // revizyone a, ki wè chanjman kontni epi ki kase ansyen antre a.
        to: "public/bg-hero-v2.webp",
        run: (s) => s.webp({ quality: 82, effort: 6 }),
        note: "sous <picture> hero mobil — LCP",
      },
      {
        to: "public/bg-hero-v2.jpg",
        run: (s) => s.jpeg({ quality: 82, mozjpeg: true }),
        note: "repli <picture> hero mobil",
      },
    ],
  },
  {
    from: "public/hero-livreur-v2.png",
    outputs: [
      {
        to: "public/hero-livreur-v2.jpg",
        run: (s) => s.jpeg({ quality: 82, mozjpeg: true }),
        note: "repli <picture> hero biwo",
      },
    ],
  },
  {
    from: "public/app-mockup-v3.png",
    outputs: [
      {
        to: "public/app-mockup-v4.webp",
        run: (s) => s.webp({ quality: 90, effort: 6 }),
        note: "sous <picture> — alfa entak",
      },
      {
        // `palette: false` EKSPLISIT. San li, `effort` alime kantifikasyon.
        to: "public/app-mockup-v4.png",
        run: (s) => s.png({ compressionLevel: 9, effort: 10, palette: false }),
        note: "repli <picture> — san pet",
      },
    ],
  },
];

const dry = process.argv.includes("--dry");

let before = 0;
let after = 0;
let problems = 0;

for (const job of JOBS) {
  const short = job.from.replace("public/", "");

  // Sous la pa la anko: script la deja kouri. Sa fe l idanpotan.
  if (!existsSync(job.from)) {
    console.log(`  = ${short.padEnd(21)} (deja fet)`);
    continue;
  }

  const orig = readFileSync(job.from);
  const meta = await sharp(orig).metadata();
  const eB = (await sharp(orig).stats()).entropy;
  before += orig.length;

  console.log(`  ${short}  ${meta.width}x${meta.height}  ${(orig.length / 1024).toFixed(0)} Ko`);

  const written = [];
  let jobOk = true;

  for (const o of job.outputs) {
    const out = await o.run(sharp(orig)).toBuffer();

    // MENM GAD AK resize-category-images.mjs. Entropi mezire konbyen
    // enfomasyon ki nan imaj la. Yon chit vle di nou jete detay, pa jis
    // octe — se sel fason pou konnen san yon moun chita gade chak imaj.
    const eA = (await sharp(out).stats()).entropy;
    const drop = eB > 0 ? (eB - eA) / eB : 0;
    const warn = drop > 0.15 ? `  ⚠ entropi tonbe ${(drop * 100).toFixed(0)}%` : "";
    if (warn) {
      problems++;
      jobOk = false;
    }

    after += out.length;
    written.push({ path: o.to, buf: out });

    console.log(
      `      ${dry ? "?" : "→"} ${o.to.replace("public/", "").padEnd(21)} ` +
        `${(out.length / 1024).toFixed(0).padStart(4)} Ko  ` +
        `[entropi ${eB.toFixed(2)}→${eA.toFixed(2)}]${warn}  ${o.note}`,
    );
  }

  // Pa ekri anyen si yon soti echwe — yon moun dwe gade imaj la anvan. Epi
  // sitou: pa efase sous la si tout soti yo pa bon.
  if (dry || !jobOk) continue;

  for (const w of written) writeFileSync(w.path, w.buf);
  if (!written.some((w) => w.path === job.from)) unlinkSync(job.from);
}

if (before > 0) {
  console.log("");
  console.log(`  anvan : ${(before / 1024).toFixed(0)} Ko`);
  console.log(`  apre  : ${(after / 1024).toFixed(0)} Ko  (tout fichye, repli ladan)`);
  console.log(
    `  ekonomi: ${((before - after) / 1024).toFixed(0)} Ko ` +
      `(${(((before - after) / before) * 100).toFixed(0)}%)` +
      (dry ? "   [--dry: anyen pa ekri]" : ""),
  );
}

if (problems > 0) {
  console.error(`\n  ⚠ ${problems} soti kote entropi tonbe anpil — pa ekri. Gade yo.`);
  process.exit(1);
}

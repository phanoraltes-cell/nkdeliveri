import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * HAZARD — yon CHECK ... IN (...) ki reekri epi ki PÈDI yon valè.
 *
 * Patwon an frape 2 fwa nan pwojè sa a, sou MENM kontrent lan
 * (wallet_transactions_type_check):
 *
 *   1. 20260901010000 te reekri l san payout_pending /
 *      payout_provider_confirmed / payout_provider_failed. Li pa t
 *      echwe paske chemen peman pwovidè a pa t janm kouri — donk yon
 *      chemen lajan te rete kase AN SILANS.
 *   2. 20260901080000 te reekri l san topup_credit /
 *      order_payment_debit / order_refund_credit / wallet_adjustment,
 *      epi li echwe ak 23514 sou vrè baz done a — men SÈLMAN paske yon
 *      ranje topup_credit te deja egziste.
 *
 * Nan tou de ka yo, echèk la (oswa silans lan) rive LWEN de kòd la. Yon
 * lis CHECK ki reekri dwe toujou yon INYON: ou ka AJOUTE yon valè, ou pa
 * ka retire youn san yon migrasyon done eksplisit.
 *
 * MENM FILOZOFI AK CHECKER OVERLOAD LA: yon pèt nan istwa a se yon vrè
 * pwoblèm SÈLMAN si okenn definisyon PITA pa restore valè a. Si yon
 * migrasyon apre remete l, eta final la kòrèk epi yon nouvo PR pa gen
 * anyen pou ranje.
 *
 * Si yon valè dwe RETIRE tout bon, mete non kontrent lan nan
 * ALLOW_SHRINK anba a — sa vin yon desizyon, pa yon aksidan.
 */

/** Kontrent kote yon valè gen dwa disparèt (mete yon nòt ki di poukisa). */
const ALLOW_SHRINK = new Set([
  // Konvèsyon enum -> text + CHECK; ansyen lis la pa t yon CHECK.
  "payouts_status_check",
]);

function stripNoise(text) {
  return text.replace(/--[^\n]*/g, " ");
}

export function findCheckConstraintDrift(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Tout definisyon nan lòd, pa non kontrent.
  const definitions = new Map(); // non -> [{ file, values:Set }]
  const addRe = /ADD\s+CONSTRAINT\s+(\w+)\s+CHECK\s*\(\s*[\w."]+\s+IN\s*\(([^)]*)\)/gi;

  for (const file of files) {
    const text = stripNoise(readFileSync(join(dir, file), "utf8"));
    let m;
    while ((m = addRe.exec(text))) {
      const name = m[1];
      const values = new Set((m[2].match(/'([^']*)'/g) ?? []).map((v) => v.slice(1, -1)));
      if (values.size === 0) continue;
      const list = definitions.get(name) ?? [];
      list.push({ file, values });
      definitions.set(name, list);
    }
  }

  const drift = [];

  for (const [name, defs] of definitions) {
    if (ALLOW_SHRINK.has(name)) continue;

    let union = new Set();
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i];
      if (i > 0) {
        const lost = [...union].filter((v) => !def.values.has(v));
        const stillLost = lost.filter((v) => !defs.slice(i + 1).some((d) => d.values.has(v)));
        if (stillLost.length > 0) {
          drift.push({ name, file: def.file, previousFile: defs[i - 1].file, lost: stillLost });
        }
      }
      union = new Set([...union, ...def.values]);
    }
  }

  return drift;
}

export function reportCheckConstraintDrift() {
  const drift = findCheckConstraintDrift();
  if (drift.length === 0) return 0;

  console.error("check-migration-hazards: " + drift.length + " CHECK ki pèdi valè:\n");
  for (const d of drift) {
    console.error("  " + d.file);
    console.error(
      "    " + d.name + " pèdi: " + d.lost.join(", ") + " (yo te la depi " + d.previousFile + ")",
    );
    console.error(
      "    Yon lis CHECK ki reekri dwe yon INYON. Ajoute valè ki manke yo,\n" +
        "    oswa mete non kontrent lan nan ALLOW_SHRINK ak yon nòt.\n",
    );
  }
  return drift.length;
}

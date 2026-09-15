import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * ENVARYAN: YON KÒMAND KI PASE PA `delivery_failed` EPI APRE PA `delivered`
 * BAY YON SÈL KREDI LIVRÈ, PA DE.
 *
 * ---------------------------------------------------------------------------
 * POUKISA TCHÈK SA A EGZISTE
 *
 * De trigger apa kredite menm livrè a pou menm kous la:
 *
 *   trg_generate_commission_on_delivery            -> 'order_commission'
 *     WHEN (NEW.status='delivered' AND OLD.status IS DISTINCT FROM 'delivered')
 *
 *   trg_generate_driver_commission_on_delivery_failure
 *     -> 'driver_commission_delivery_failed'
 *     WHEN (NEW.status='delivery_failed' AND ...)
 *
 * Kle inik pasyèl yo diferan (`WHERE entry_type = ...`), donk de liy yo
 * koegziste san okenn konflik. Epi bouton prensipal ekran admin lan se
 * egzakteman « make livre » — donk chemen ONÈT la te peye de fwa.
 *
 * Migrasyon 20260915000000 fèmen sa ak de bagay ki dwe RETE VRE:
 *
 *   (A) kredi echèk la ale nan `pending_balance`, pa `available_balance`
 *   (B) yon trigger ranvèse l lè kòmand lan vin `delivered`
 *
 * Retire youn nan de a epi doub kredi a tounen — an silans, paske anyen nan
 * tès inite yo pa pale ak yon vrè Postgres.
 *
 * ---------------------------------------------------------------------------
 * DE KOUCH, MENM JAN AK check-money-authorization.mjs
 *
 *   1. Tchèk sa a — li verifye sa migrasyon yo DEKLARE, epi li kouri nan
 *      `npm run verify` sou chak chanjman.
 *   2. Yon vrè verifikasyon sou baz la rete travay Altes (yon kòmand tès ki
 *      pase echèk -> livre, epi konte liy `commission_ledger` yo).
 *
 * Yon tchèk ki pa ka echwe pa pwouve anyen: tès la nan
 * src/lib/__tests__/failed-delivery-credit.test.ts pwouve chak règ detekte
 * yon vrè vyolasyon.
 */

function stripComments(text) {
  return text.replace(/--[^\n]*/g, " ");
}

function migrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ name: f, sql: stripComments(readFileSync(join(dir, f), "utf8")) }));
}

/**
 * Kò yon fonksyon PL/pgSQL pa non li — dènye definisyon an genyen, paske
 * se sa ki nan baz la apre tout migrasyon yo kouri.
 */
function lastFunctionBody(files, name) {
  let body = null;
  let file = null;
  const re = new RegExp(
    `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:private|public)\\.${name}\\s*\\(`,
    "gi",
  );
  for (const f of files) {
    let m;
    while ((m = re.exec(f.sql)) !== null) {
      const start = m.index;
      const end = f.sql.indexOf("$$;", start);
      if (end === -1) continue;
      body = f.sql.slice(start, end);
      file = f.name;
    }
    re.lastIndex = 0;
  }
  return body === null ? null : { body, file };
}

/** Dènye `CREATE TRIGGER <name>` — ak kloz `WHEN` li. */
function lastTrigger(files, name) {
  let found = null;
  for (const f of files) {
    const re = new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[\\s\\S]*?;`, "gi");
    let m;
    while ((m = re.exec(f.sql)) !== null) found = { text: m[0], file: f.name };
  }
  return found;
}

/** Eske yon migrasyon PI RESAN retire trigger la? */
function droppedAfter(files, triggerName, afterFile) {
  return files.some(
    (f) =>
      f.name > afterFile &&
      new RegExp(`DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?${triggerName}\\b`, "i").test(f.sql) &&
      !new RegExp(`CREATE\\s+TRIGGER\\s+${triggerName}\\b`, "i").test(f.sql),
  );
}

export function findFailedDeliveryCreditViolations(dir = MIGRATIONS_DIR) {
  const files = migrationFiles(dir);
  const violations = [];

  // --- Règ A: kredi echèk la pwovizwa ---
  const credit = lastFunctionBody(files, "generate_driver_commission_on_delivery_failure");
  if (credit === null) {
    violations.push(
      "generate_driver_commission_on_delivery_failure pa jwenn — envaryan an pa ka verifye.",
    );
  } else if (/available_balance\s*=\s*wallets\.available_balance\s*\+/i.test(credit.body)) {
    violations.push(
      `${credit.file}: kredi sou livrezon echwe ale nan \`available_balance\` — li dwe ale nan ` +
        "`pending_balance` jiskaske yon admin tranche, sinon li depansab san okenn kontwòl.",
    );
  } else if (!/pending_balance\s*=\s*wallets\.pending_balance\s*\+/i.test(credit.body)) {
    violations.push(
      `${credit.file}: kredi sou livrezon echwe pa ale nan \`pending_balance\` non plis — ` +
        "verifye ki bous li alimante.",
    );
  }

  // --- Règ B: ranvèsman otomatik lè kòmand lan vin `delivered` ---
  const trigger = lastTrigger(files, "trg_reverse_provisional_on_delivered");
  if (trigger === null) {
    violations.push(
      "Okenn trigger `trg_reverse_provisional_on_delivered` — san li, yon kòmand ki pase pa " +
        "`delivery_failed` epi apre pa `delivered` bay DE kredi livrè.",
    );
  } else {
    if (droppedAfter(files, "trg_reverse_provisional_on_delivered", trigger.file)) {
      violations.push(
        "`trg_reverse_provisional_on_delivered` retire pa yon migrasyon pi resan san yo pa remete l.",
      );
    }
    // Kondisyon an dwe kouvri TOUT antre nan `delivered`. Yon
    // `OLD.status = 'delivery_failed'` twò etwat: yon admin gen dwa fè
    // delivery_failed -> cancelled -> delivered, epi dezyèm so a pa t ap
    // deklanche.
    if (!/OLD\.status\s+IS\s+DISTINCT\s+FROM\s+'delivered'/i.test(trigger.text)) {
      violations.push(
        `${trigger.file}: kondisyon \`trg_reverse_provisional_on_delivered\` twò etwat — li dwe ` +
          "sèvi ak `OLD.status IS DISTINCT FROM 'delivered'`, sinon yon chemen " +
          "delivery_failed -> cancelled -> delivered kite de kredi.",
      );
    }
  }

  // --- Règ C: fonksyon ranvèsman an dwe egziste epi vize bon antre a ---
  const reverse = lastFunctionBody(files, "reverse_provisional_on_delivered");
  if (reverse === null) {
    violations.push("private.reverse_provisional_on_delivered pa jwenn.");
  } else if (!/driver_commission_delivery_failed/i.test(reverse.body)) {
    violations.push(
      `${reverse.file}: fonksyon ranvèsman an pa chèche antre ` +
        "`driver_commission_delivery_failed` — li p ap ranvèse anyen.",
    );
  }

  return violations;
}

export function reportFailedDeliveryCreditViolations() {
  const violations = findFailedDeliveryCreditViolations();
  if (violations.length === 0) {
    console.log("check-failed-delivery-credit: envaryan an kenbe — yon sèl kredi livrè pa kòmand.");
    return 0;
  }
  console.error("check-failed-delivery-credit: VYOLASYON");
  for (const v of violations) console.error(`  - ${v}`);
  return violations.length;
}

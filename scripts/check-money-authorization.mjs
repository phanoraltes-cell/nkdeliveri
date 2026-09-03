import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

/**
 * TACH 4 — verifikasyon otomatik sou refi wòl (role denial).
 *
 * POUKISA YON SKRIP ESTATIK: ni Vitest (Supabase mock) ni Playwright
 * (mock rezo konplè, wè playwright.config.ts) pa pale ak yon vrè
 * Postgres — donk OKENN nan yo pa ka pwouve RLS/GRANT reyèl. Skrip sa a
 * verifye sa migrasyon yo DEKLARE (li kouri nan CI, san baz done), epi
 * scripts/sql/verify-money-authorization.sql verifye sa ki REYÈLMAN
 * deplwaye (kouri nan Supabase SQL Editor).
 *
 * ENVARYAN LI FÈ RESPEKTE:
 *   A. Sifas `anon` lan pa ka grandi san yon desizyon delibere.
 *   B. RPC ki se service_role SÈLMAN pa janm vin rele pa `authenticated`.
 *   C. Chak tab lajan gen RLS AKTIVE.
 *   D. Okenn tab lajan pa gen yon règleman EKRITI pou `authenticated` —
 *      tout ekriti pase pa yon RPC SECURITY DEFINER. (Se pa GRANT la ki
 *      fwontyè a: public.payments kenbe yon ansyen GRANT UPDATE, men
 *      20260813130000 retire règleman an, donk RLS refize l pa defo.)
 *   E. Chak fonksyon lajan gen yon REVOKE ki site `anon` EKSPLISITMAN.
 */

/** Fonksyon `anon` gen dwa rele — chak youn se lekti piblik, okenn pa touche lajan. Ajoute yon non isit la se yon DESIZYON, pa yon aksidan. */
const ANON_ALLOWLIST = new Set([
  "public.check_auth_rate_limit_secure",
  "public.compute_restaurant_promotion_discount",
  "public.get_active_placements_secure",
  "public.get_platform_payout_public",
  "public.get_primary_role",
  "public.has_role",
  "public.is_restaurant_open",
  "public.list_restaurants_public",
  "public.log_ad_event_secure",
  "public.subscribe_newsletter_secure",
  "public.validate_promo_code_secure",
]);

/** RPC ki deplase lajan epi ki dwe rete rele SÈLMAN pa service_role (cron/webhook), jamè pa yon sesyon itilizatè. */
const SERVICE_ROLE_ONLY = [
  "public.complete_pending_payout_secure",
  "public.fail_pending_payout_secure",
  "public.complete_wallet_topup_secure",
  "public.expire_stale_wallet_topups_secure",
  "public.complete_collect_payment_secure",
];

/** Tab ki kenbe lajan oswa ki deside konbyen lajan yon moun gen. */
const MONEY_TABLES = [
  "wallets",
  "wallet_transactions",
  "payouts",
  "payout_commissions",
  "payment_intents",
  "commission_ledger",
  "payments",
  "withdrawal_rules",
];

const WRITE_COMMANDS = ["INSERT", "UPDATE", "DELETE", "ALL"];

/** Modèl non fonksyon ki touche lajan — menm lis ak verify-money-authorization.sql. */
const MONEY_FUNCTION_RE = /(payout|withdrawal|wallet|topup|refund|commission|order_secure)/i;

/** Fonksyon lajan ki gen dwa rete rele pa anon — desizyon delibere, dokimante. */
const MONEY_ANON_ALLOWED = new Set(["get_platform_payout_public"]);

function stripNoise(text) {
  return text.replace(/--[^\n]*/g, " ");
}

function migrationFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export function findMoneyAuthViolations(dir = MIGRATIONS_DIR) {
  const files = migrationFiles(dir);

  const functionGrants = new Map(); // non konplè -> Set(wòl), eta final
  const rlsEnabled = new Set();
  const writePolicies = new Map(); // "table::policy" -> komand
  const moneyFunctionsCreated = new Set();
  const anonRevoked = new Set();

  for (const file of files) {
    const text = stripNoise(readFileSync(join(dir, file), "utf8"));
    let m;

    const grantRe = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\w.]+)\s*\([^)]*\)\s*TO\s+([^;]+);/gi;
    while ((m = grantRe.exec(text))) {
      const fn = m[1].trim();
      const set = functionGrants.get(fn) ?? new Set();
      for (const r of m[2].split(",")) set.add(r.trim().toLowerCase());
      functionGrants.set(fn, set);
    }

    const revokeRe = /REVOKE\s+[^;]*?ON\s+FUNCTION\s+([\w.]+)\s*\([^)]*\)\s*FROM\s+([^;]+);/gi;
    while ((m = revokeRe.exec(text))) {
      const fn = m[1].trim();
      const roles = m[2].split(",").map((r) => r.trim().toLowerCase());
      const set = functionGrants.get(fn);
      if (set) for (const r of roles) set.delete(r);
      if (roles.includes("anon")) anonRevoked.add(fn.replace(/^public\./, ""));
    }

    const createFnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(/gi;
    while ((m = createFnRe.exec(text))) {
      if (MONEY_FUNCTION_RE.test(m[1])) moneyFunctionsCreated.add(m[1]);
    }

    const rlsRe = /ALTER\s+TABLE\s+(?:public\.)?(\w+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
    while ((m = rlsRe.exec(text))) rlsEnabled.add(m[1]);

    const policyRe =
      /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?(\w+)\s+FOR\s+(\w+)\s+TO\s+([^\s]+)/gi;
    while ((m = policyRe.exec(text))) {
      const [, policy, table, command, role] = m;
      if (
        MONEY_TABLES.includes(table) &&
        WRITE_COMMANDS.includes(command.toUpperCase()) &&
        role.toLowerCase().startsWith("authenticated")
      ) {
        writePolicies.set(table + "::" + policy, command.toUpperCase());
      }
    }

    const dropPolicyRe = /DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+(?:public\.)?(\w+)/gi;
    while ((m = dropPolicyRe.exec(text))) writePolicies.delete(m[2] + "::" + m[1]);
  }

  const violations = [];

  for (const [fn, roles] of functionGrants) {
    if (roles.has("anon") && !ANON_ALLOWLIST.has(fn)) {
      violations.push({
        check: "A",
        detail: fn + " rele pa `anon` men li pa nan ANON_ALLOWLIST.",
      });
    }
  }

  for (const fn of SERVICE_ROLE_ONLY) {
    if (functionGrants.get(fn)?.has("authenticated")) {
      violations.push({
        check: "B",
        detail: fn + " se service_role SÈLMAN men li gen GRANT pou `authenticated`.",
      });
    }
  }

  for (const table of MONEY_TABLES) {
    if (!rlsEnabled.has(table)) {
      violations.push({ check: "C", detail: "public." + table + " pa gen RLS aktive." });
    }
  }

  for (const [key, command] of writePolicies) {
    const [table, policy] = key.split("::");
    violations.push({
      check: "D",
      detail:
        "public." +
        table +
        ' gen yon règleman EKRITI pou `authenticated`: "' +
        policy +
        '" (' +
        command +
        "). Tout ekriti sou tab lajan dwe pase pa yon RPC SECURITY DEFINER.",
    });
  }

  // E) Supabase bay anon EXECUTE PA DEFO sou chak nouvo fonksyon nan
  // public (ALTER DEFAULT PRIVILEGES). Yon `REVOKE ... FROM PUBLIC` PA
  // retire dwa dirèk sa a — PUBLIC ak anon se 2 bagay diferan. Premye
  // vèsyon verifikasyon sa a pa t genyen E: li te di 0 vyolasyon pandan
  // vrè baz done a te gen 15 fonksyon lajan rele pa anon.
  for (const fn of moneyFunctionsCreated) {
    if (MONEY_ANON_ALLOWED.has(fn)) continue;
    if (!anonRevoked.has(fn)) {
      violations.push({
        check: "E",
        detail:
          "public." +
          fn +
          " pa gen okenn REVOKE ki site `anon`. Supabase bay anon EXECUTE pa " +
          "defo; yon REVOKE FROM PUBLIC sèl PA ase.",
      });
    }
  }

  return violations;
}

export function reportMoneyAuthViolations() {
  const violations = findMoneyAuthViolations();
  if (violations.length === 0) return 0;
  console.error(
    "check-migration-hazards: " + violations.length + " vyolasyon otorizasyon lajan:\n",
  );
  for (const v of violations) console.error("  [" + v.check + "] " + v.detail + "\n");
  return violations.length;
}

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
 * scripts/verify-money-authorization.sql verifye sa ki REYÈLMAN deplwaye
 * (Altes kouri l nan Supabase SQL Editor).
 *
 * ENVARYAN LI FÈ RESPEKTE:
 *   A. Sifas `anon` lan pa ka grandi san yon desizyon delibere.
 *   B. RPC ki se service_role SÈLMAN pa janm vin rele pa `authenticated`.
 *   C. Chak tab lajan gen RLS AKTIVE.
 *   D. Okenn tab lajan pa gen yon règleman EKRITI pou `authenticated` —
 *      tout ekriti pase pa yon RPC SECURITY DEFINER. (Se pa GRANT la ki
 *      fwontyè a: public.payments kenbe yon ansyen GRANT UPDATE, men
 *      20260813130000 retire règleman an, donk RLS refize l pa defo.)
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

  // Eta final pa fonksyon: non -> Set(wòl)
  const functionGrants = new Map();
  // Tab ki gen RLS aktive
  const rlsEnabled = new Set();
  // Règleman ekriti sou tab: "table::policy" -> komand
  const writePolicies = new Map();

  for (const file of files) {
    const text = stripNoise(readFileSync(join(dir, file), "utf8"));

    const grantRe = /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+([\w.]+)\s*\([^)]*\)\s*TO\s+([^;]+);/gi;
    let m;
    while ((m = grantRe.exec(text))) {
      const fn = m[1].trim();
      const roles = m[2].split(",").map((r) => r.trim().toLowerCase());
      const set = functionGrants.get(fn) ?? new Set();
      for (const r of roles) set.add(r);
      functionGrants.set(fn, set);
    }

    const revokeRe = /REVOKE\s+[^;]*?ON\s+FUNCTION\s+([\w.]+)\s*\([^)]*\)\s*FROM\s+([^;]+);/gi;
    while ((m = revokeRe.exec(text))) {
      const fn = m[1].trim();
      const roles = m[2].split(",").map((r) => r.trim().toLowerCase());
      const set = functionGrants.get(fn);
      if (set) for (const r of roles) set.delete(r);
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
        detail: `${fn} rele pa \`anon\` men li pa nan ANON_ALLOWLIST. Si se vle a, ajoute l nan lis la eksplisitman.`,
      });
    }
  }

  for (const fn of SERVICE_ROLE_ONLY) {
    const roles = functionGrants.get(fn);
    if (roles?.has("authenticated")) {
      violations.push({
        check: "B",
        detail: `${fn} se service_role SÈLMAN men li gen GRANT pou \`authenticated\` — nenpòt sesyon konekte ta ka rele l.`,
      });
    }
  }

  for (const table of MONEY_TABLES) {
    if (!rlsEnabled.has(table)) {
      violations.push({ check: "C", detail: `public.${table} pa gen RLS aktive.` });
    }
  }

  for (const [key, command] of writePolicies) {
    const [table, policy] = key.split("::");
    violations.push({
      check: "D",
      detail: `public.${table} gen yon règleman EKRITI pou \`authenticated\`: "${policy}" (${command}). Tout ekriti sou tab lajan dwe pase pa yon RPC SECURITY DEFINER.`,
    });
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

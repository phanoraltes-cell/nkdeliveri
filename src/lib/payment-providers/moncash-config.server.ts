/**
 * Central, validated access to MonCash secrets. No other module should
 * read `process.env.MONCASH_*` directly — always go through here, so
 * there is exactly one place that knows these variable names and exactly
 * one place to audit for "could this ever reach the client bundle."
 *
 * `.server.ts` is load-bearing, not stylistic (same rule as
 * moncash-provider.server.ts and integrations/supabase/client.server.ts):
 * the build fails if a route file or component ever imports this module
 * directly, which is what keeps every value below out of the browser by
 * construction rather than by convention.
 *
 * See docs/PAYMENT_PROVIDERS.md for where each variable comes from and
 * how to set it.
 */
export type MonCashConfig = {
  clientId: string;
  clientSecret: string;
  merchantId: string;
  apiUrl: string;
  webhookSecret: string;
};

const REQUIRED_VARS = [
  "MONCASH_CLIENT_ID",
  "MONCASH_CLIENT_SECRET",
  "MONCASH_MERCHANT_ID",
  "MONCASH_API_URL",
  "MONCASH_WEBHOOK_SECRET",
] as const;

function readConfig(): MonCashConfig | undefined {
  const [clientId, clientSecret, merchantId, apiUrl, webhookSecret] = REQUIRED_VARS.map(
    (name) => process.env[name],
  );
  if (!clientId || !clientSecret || !merchantId || !apiUrl || !webhookSecret) return undefined;
  return { clientId, clientSecret, merchantId, apiUrl, webhookSecret };
}

/**
 * True once every MONCASH_* secret is present. Never throws — this is
 * what `moncashProvider.isConfigured()` calls, and it must stay cheap and
 * side-effect-free since it can be checked on any admin payout page load.
 */
export function isMonCashConfigured(): boolean {
  return readConfig() !== undefined;
}

/**
 * Returns the full config, or throws a clear error listing exactly which
 * variables are missing (never the values themselves). Only call after
 * confirming `isMonCashConfigured()`, or from code that only runs once a
 * caller already has — mirrors `client.server.ts`'s own
 * createSupabaseAdminClient() error shape.
 */
export function getMonCashConfig(): MonCashConfig {
  const config = readConfig();
  if (!config) {
    const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
    throw new Error(
      `Konfigirasyon MonCash pa konplè — varyab sa yo manke: ${missing.join(", ")}. Gade docs/PAYMENT_PROVIDERS.md.`,
    );
  }
  return config;
}

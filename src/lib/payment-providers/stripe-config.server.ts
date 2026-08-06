/**
 * Central, validated access to Stripe secrets. No other module should
 * read `process.env.STRIPE_*` directly — always go through here, same
 * convention as plop-config.server.ts/moncash-config.server.ts (one
 * module per provider that knows these variable names, one place to
 * audit for "could this ever reach the client bundle").
 *
 * `.server.ts` is load-bearing, not stylistic: the build fails if a route
 * file or component ever imports this module directly, which is what
 * keeps `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` out of the browser by
 * construction.
 *
 * Deliberately built ahead of real credentials being set (per the
 * mission's own "nap konfigire API yo pita" — keys added later): every
 * caller must go through `isStripeConfigured()` first, exactly like
 * plopProvider.isConfigured()/moncashProvider's own equivalent, so the
 * checkout button/RPC gate can exist and be reviewed today while staying
 * genuinely inert (never reachable) until real keys land in the
 * environment.
 */
export type StripeConfig = {
  secretKey: string;
  /** Only used client-side (Stripe.js), never sent in any server request — kept here anyway so this module stays the single place that knows every STRIPE_* variable name that exists. */
  publishableKey: string;
  /** Required to verify inbound webhook signatures (`stripe.webhooks.constructEvent`) — without it, verifyWebhook() must fail closed, never skip verification. */
  webhookSecret: string;
  /**
   * The currency Stripe actually charges the card in — NOT necessarily
   * HTG. Every amount in this app (`payments.amount`/`payments.currency`)
   * is HTG, but Haiti is not one of Stripe's ~46 supported countries for
   * holding a merchant account, and HTG is very likely not a currency
   * Stripe settles in at all (unconfirmed either way from public docs at
   * the time this was written — deliberately not asserted as fact).
   * Whoever configures real Stripe credentials must also pick a real
   * presentment currency Stripe actually supports for their account
   * (almost certainly USD, via a foreign entity — see
   * docs/STRIPE_INTEGRATION_REPORT.md). Defaults to "usd" only as a
   * placeholder default value, never silently assumed correct without
   * this file's own doc comment being read first.
   */
  presentmentCurrency: string;
  /**
   * HTG -> presentmentCurrency conversion rate (1 HTG = this many units
   * of presentmentCurrency, e.g. 1 HTG = 0.0076 USD). Deliberately has NO
   * built-in default — a fabricated exchange rate would silently
   * overcharge or undercharge every single customer, so this must be set
   * explicitly by whoever configures real credentials, and reviewed
   * periodically by hand (this is a manual rate, not a live feed — a
   * known limitation, see docs/STRIPE_INTEGRATION_REPORT.md).
   */
  htgConversionRate: number;
};

const REQUIRED_VARS = [
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_HTG_CONVERSION_RATE",
] as const;

function readConfig(): StripeConfig | undefined {
  const [secretKey, publishableKey, webhookSecret, rateRaw] = REQUIRED_VARS.map(
    (name) => process.env[name],
  );
  if (!secretKey || !publishableKey || !webhookSecret || !rateRaw) return undefined;
  const htgConversionRate = Number(rateRaw);
  if (!Number.isFinite(htgConversionRate) || htgConversionRate <= 0) return undefined;
  const presentmentCurrency = (process.env.STRIPE_PRESENTMENT_CURRENCY || "usd").toLowerCase();
  return { secretKey, publishableKey, webhookSecret, presentmentCurrency, htgConversionRate };
}

/**
 * True once every STRIPE_* secret is present. Never throws — this is what
 * `stripeProvider.isConfigured()` calls, and it must stay cheap and
 * side-effect-free since it can be checked on any checkout page load.
 */
export function isStripeConfigured(): boolean {
  return readConfig() !== undefined;
}

/**
 * Returns the full config, or throws a clear error listing exactly which
 * variables are missing (never the values themselves). Only call after
 * confirming `isStripeConfigured()`, or from code that only runs once a
 * caller already has.
 */
export function getStripeConfig(): StripeConfig {
  const config = readConfig();
  if (!config) {
    const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
    throw new Error(`Konfigirasyon Stripe pa konplè — varyab sa yo manke: ${missing.join(", ")}.`);
  }
  return config;
}

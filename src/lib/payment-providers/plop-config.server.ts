/**
 * Central, validated access to PLOP secrets. No other module should read
 * `process.env.PLOP_*` directly — always go through here, mirroring
 * moncash-config.server.ts's own convention (one module per provider that
 * knows these variable names, one place to audit for "could this ever
 * reach the client bundle").
 *
 * `.server.ts` is load-bearing, not stylistic: the build fails if a route
 * file or component ever imports this module directly, which is what
 * keeps `PLOP_CLIENT_SECRET` out of the browser by construction.
 *
 * PLOP's base URL is a constant, not an environment variable — the
 * documentation (see docs/archive/plop/PLOP_PHASE0_AUDIT.md) describes exactly one
 * endpoint, no sandbox, so an env var here would only be one more place a
 * typo could silently break the integration for zero real benefit.
 */
export type PlopConfig = {
  clientId: string;
  clientSecret: string;
  /** `moncash` | `kashpaw` | `natcash` | `all` per PLOP's documented `payment_method` field — see docs/archive/plop/PLOP_PHASE0_AUDIT.md § 7. Defaults to `moncash`: the only rail this replacement covers (Kashpaw/NatCash via PLOP are out of scope). */
  paymentMethod: string;
};

const REQUIRED_VARS = ["PLOP_CLIENT_ID", "PLOP_CLIENT_SECRET"] as const;
const DEFAULT_PAYMENT_METHOD = "moncash";

/** No trailing slash — every call site appends its own leading `/api/...`. */
export const PLOP_BASE_URL = "https://plopplop.solutionip.app";

function readConfig(): PlopConfig | undefined {
  const [clientId, clientSecret] = REQUIRED_VARS.map((name) => process.env[name]);
  if (!clientId || !clientSecret) return undefined;
  return {
    clientId,
    clientSecret,
    paymentMethod: process.env.PLOP_PAYMENT_METHOD || DEFAULT_PAYMENT_METHOD,
  };
}

/**
 * True once every PLOP_* secret is present. Never throws — this is what
 * `plopProvider.isConfigured()` calls, and it must stay cheap and
 * side-effect-free since it can be checked on any checkout page load.
 */
export function isPlopConfigured(): boolean {
  return readConfig() !== undefined;
}

/**
 * Returns the full config, or throws a clear error listing exactly which
 * variables are missing (never the values themselves). Only call after
 * confirming `isPlopConfigured()`, or from code that only runs once a
 * caller already has.
 */
export function getPlopConfig(): PlopConfig {
  const config = readConfig();
  if (!config) {
    const missing = REQUIRED_VARS.filter((name) => !process.env[name]);
    throw new Error(
      `Konfigirasyon PLOP pa konplè — varyab sa yo manke: ${missing.join(", ")}. Gade docs/archive/plop/PLOP_PHASE1_ARCHITECTURE.md.`,
    );
  }
  return config;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * PaymentProviderAvailabilityService — the single place that reads
 * `payment_provider_settings` (visible/enabled/default/maintenance
 * message per checkout method). Every caller — checkout UI, the backend
 * enforcement in initiate-collect-payment.logic.ts, the admin dashboard —
 * goes through this module rather than querying the table directly, so
 * there is exactly one place to change if the query itself ever needs to
 * change (a join, a cache, a different table).
 *
 * Deliberately plain `.ts`, not `.server.ts`: the query is a public,
 * RLS-scoped read (no secret involved — `payment_provider_settings` grants
 * SELECT to `anon`/`authenticated`, matching the existing pattern for
 * `restaurants`), so it's safe to run from either the browser or the
 * server, exactly like this codebase's other direct-`supabase.from(...)`
 * reads (e.g. checkout.tsx's own `restaurants`/`addresses` queries).
 * Mutation (`updatePaymentProviderSetting`) is RPC-gated server-side by
 * `update_payment_provider_setting_secure`'s own admin check regardless
 * of which layer calls it — this module adds no authority of its own.
 */

export type CheckoutProviderId =
  "kach" | "moncash" | "natcash" | "moncash_auto" | "natcash_auto" | "stripe" | "wallet";

/**
 * Human-readable label per checkout method — same wording as checkout.tsx's
 * own METHODS array, single source now that a second consumer needs it.
 * F-07 (docs/archive/audits/FRONTEND_GLOBAL_AUDIT.md §25) — `stripe` (and, defensively,
 * `moncash_auto`/`natcash_auto`, though `payments.method` itself only ever
 * stores their base rail — see paymentMethodLabel() below) was missing from
 * the restaurant dashboard's own copy of this map, so a card/Stripe order
 * showed the raw provider key instead of a label.
 */
export const PAYMENT_METHOD_LABEL: Record<CheckoutProviderId, string> = {
  kach: "Kach nan livrezon",
  moncash: "MonCash",
  natcash: "NatCash",
  moncash_auto: "MonCash Otomatik",
  natcash_auto: "NatCash Otomatik",
  stripe: "Kat Kredi",
  wallet: "Wallet",
};

/**
 * Safe lookup for a `payments.method` value (typed `string` at most call
 * sites since it flows through a raw Supabase row, not always narrowed to
 * `CheckoutProviderId`) — falls back to the raw value itself for anything
 * unrecognized, same behavior as the two inline `?? method` fallbacks this
 * replaces.
 */
export function paymentMethodLabel(method: string): string {
  return (PAYMENT_METHOD_LABEL as Record<string, string>)[method] ?? method;
}

export type PaymentProviderSetting = {
  provider: CheckoutProviderId;
  visible: boolean;
  enabled: boolean;
  defaultProvider: boolean;
  maintenanceMessage: string | null;
};

function mapRow(
  row: Pick<
    Database["public"]["Tables"]["payment_provider_settings"]["Row"],
    "provider" | "visible" | "enabled" | "default_provider" | "maintenance_message"
  >,
): PaymentProviderSetting {
  return {
    provider: row.provider as CheckoutProviderId,
    visible: row.visible,
    enabled: row.enabled,
    defaultProvider: row.default_provider,
    maintenanceMessage: row.maintenance_message,
  };
}

/** All 6 checkout methods' current settings, in `provider` order. */
export async function fetchPaymentProviderSettings(
  supabase: SupabaseClient<Database>,
): Promise<PaymentProviderSetting[]> {
  const { data, error } = await supabase
    .from("payment_provider_settings")
    .select("provider, visible, enabled, default_provider, maintenance_message")
    .order("provider");
  if (error) throw error;
  return (data ?? []).map(mapRow);
}

/** True only if the given method is both `enabled` in settings — callers that also need `isConfigured()` (server-side secret presence) must check that separately, this function has no access to server secrets by design. */
export function isProviderEnabled(
  settings: PaymentProviderSetting[],
  provider: CheckoutProviderId,
): boolean {
  return settings.find((s) => s.provider === provider)?.enabled ?? false;
}

export function getProviderSetting(
  settings: PaymentProviderSetting[],
  provider: CheckoutProviderId,
): PaymentProviderSetting | undefined {
  return settings.find((s) => s.provider === provider);
}

export function getDefaultProvider(settings: PaymentProviderSetting[]): CheckoutProviderId {
  return settings.find((s) => s.defaultProvider)?.provider ?? "kach";
}

/**
 * The only write path — thin wrapper over the admin-gated RPC. Passing
 * `undefined` for a field leaves it unchanged server-side; to explicitly
 * clear `maintenanceMessage`, pass an empty string (the RPC turns that
 * into NULL), never `undefined`.
 */
export async function updatePaymentProviderSetting(
  supabase: SupabaseClient<Database>,
  provider: CheckoutProviderId,
  changes: {
    visible?: boolean;
    enabled?: boolean;
    maintenanceMessage?: string;
    setAsDefault?: boolean;
  },
): Promise<PaymentProviderSetting> {
  const { data, error } = await supabase.rpc("update_payment_provider_setting_secure", {
    _provider: provider,
    _visible: changes.visible,
    _enabled: changes.enabled,
    _maintenance_message: changes.maintenanceMessage,
    _set_as_default: changes.setAsDefault,
  });
  if (error) throw error;
  return mapRow(data);
}

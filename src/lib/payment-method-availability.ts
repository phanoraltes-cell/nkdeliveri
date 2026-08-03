/**
 * Centralized checkout payment-method availability — the single place
 * that decides which methods are shown, selectable, and default. Exists
 * so a temporary measure (disabling MonCash Automatik during the
 * Bouspam migration) is a data change in one object, not a scattered
 * set of conditionals in checkout.tsx.
 *
 * Deliberately a static in-repo config, not a database table, for this
 * pass: a `payment_provider_settings` table (visible/enabled/
 * maintenance_message/display_order/default_provider, one row per
 * method) is the natural next step and this shape mirrors it exactly —
 * but adding a migration wasn't justified for a temporary, easily
 * revertible measure. Swapping this module's export for a Supabase
 * query later requires no change at any call site, since every caller
 * already goes through getPaymentMethodAvailability()/
 * getDefaultPaymentMethod() rather than reading the object directly.
 */
export type CheckoutMethodId = "moncash_auto" | "moncash" | "natcash" | "kach";

export type PaymentMethodAvailability = {
  /** False would remove the method from the UI entirely — not used today (every method stays visible per the "Option A" decision for MonCash Automatik), kept for the future case that needs it (e.g. a method not launched yet at all). */
  visible: boolean;
  /** False disables selection — renders the method but makes it non-interactive. */
  enabled: boolean;
  /** Shown next to a disabled method's label and as its explanatory sub-text. Only meaningful when enabled is false. */
  maintenanceMessage?: string;
  displayOrder: number;
};

const PAYMENT_METHOD_AVAILABILITY: Record<CheckoutMethodId, PaymentMethodAvailability> = {
  kach: { visible: true, enabled: true, displayOrder: 0 },
  moncash: { visible: true, enabled: true, displayOrder: 1 },
  natcash: { visible: true, enabled: true, displayOrder: 2 },
  moncash_auto: {
    visible: true,
    enabled: false,
    maintenanceMessage: "MonCash Automatik pa disponib pou kounye a. L ap retounen byento.",
    displayOrder: 3,
  },
};

const DEFAULT_PAYMENT_METHOD: CheckoutMethodId = "kach";

export function getPaymentMethodAvailability(id: CheckoutMethodId): PaymentMethodAvailability {
  return PAYMENT_METHOD_AVAILABILITY[id];
}

export function getDefaultPaymentMethod(): CheckoutMethodId {
  return DEFAULT_PAYMENT_METHOD;
}

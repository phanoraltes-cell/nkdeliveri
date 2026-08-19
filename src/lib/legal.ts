/**
 * Single source of truth for the Kondisyon Itilizasyon / Politik
 * Konfidansyalite document version (NKD-022). Bump this string whenever
 * /terms or /privacy's actual content changes materially — every place
 * that records or checks acceptance (registration forms' signup metadata,
 * terms-acceptance-gate.tsx, accept_terms_secure) reads from here, so a
 * content change plus a version bump here is enough to make every account
 * (new AND existing) re-prompted, with no other code change needed.
 */
export const CURRENT_TERMS_VERSION = "1.0";

// Small shared constants for the handful of UI primitives genuinely
// reused across ≥3 spec files (confirm dialogs, star ratings, add-to-
// cart) — everything else is a short enough literal that inlining it in
// each spec is clearer than a full Page Object Model layer (see
// docs/archive/audits/E2E_TEST_REPORT.md § architecture decision). All text is literal
// Haitian Creole (Kreyòl) copied verbatim from the source components —
// never translate or paraphrase these strings.

export const CONFIRM_DIALOG = {
  cancel: "Anile",
  confirm: "Konfime",
};

export const CART = {
  addToCart: (productName: string) => `Ajoute ${productName} nan panye`,
};

export const REVIEW = {
  star: (n: number) => `${n} zetwal sou 5`,
};

export const GPS_TOGGLE = {
  off: "Aktive",
  on: "Aktif",
};

export const NOTIFICATIONS_TABS = [
  "Tout",
  "Non lu",
  "Kòmand",
  "Livrezon",
  "Peman",
  "Komisyon",
  "Pwomosyon",
  "Litij",
  "Sistèm",
] as const;

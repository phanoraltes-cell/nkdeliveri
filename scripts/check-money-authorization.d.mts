/** Deklarasyon tip pou check-money-authorization.mjs — pèmèt tès TS yo tipe rezilta a olye `any`. */
export type MoneyAuthViolation = {
  /** "A" = sifas anon, "B" = RPC service_role, "C" = RLS, "D" = ekriti dirèk. */
  check: "A" | "B" | "C" | "D";
  detail: string;
};

export function findMoneyAuthViolations(dir?: string): MoneyAuthViolation[];
export function reportMoneyAuthViolations(): number;

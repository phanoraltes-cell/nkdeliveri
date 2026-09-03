/** Deklarasyon tip pou check-money-authorization.mjs — pèmèt tès TS yo tipe rezilta a olye `any`. */
export type MoneyAuthViolation = {
  /** "A" = sifas anon, "B" = RPC service_role, "C" = RLS, "D" = ekriti dirèk, "E" = dwa dirèk anon (default privileges Supabase). */
  check: "A" | "B" | "C" | "D" | "E";
  detail: string;
};

export function findMoneyAuthViolations(dir?: string): MoneyAuthViolation[];
export function reportMoneyAuthViolations(): number;

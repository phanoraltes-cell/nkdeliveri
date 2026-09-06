/** Deklarasyon tip pou check-check-constraint-drift.mjs. */
export type CheckConstraintDrift = {
  /** Non kontrent lan (egz. wallet_transactions_type_check). */
  name: string;
  /** Migrasyon ki pèdi valè yo. */
  file: string;
  /** Migrasyon anvan an, kote valè yo te toujou la. */
  previousFile: string;
  /** Valè ki disparèt epi ki pa janm restore pa yon migrasyon pita. */
  lost: string[];
};

export function findCheckConstraintDrift(dir?: string): CheckConstraintDrift[];
export function reportCheckConstraintDrift(): number;

/** Deklarasyon tip pou check-sql-delimiters.mjs. */
export type SqlDelimiterProblem = {
  /** Non fichye migrasyon an. */
  file: string;
  /** Sa ki kase, ak nimewo liy yo lè sa itil. */
  problem: string;
};

export function findSqlDelimiterProblems(dir?: string): SqlDelimiterProblem[];
export function reportSqlDelimiterProblems(): number;

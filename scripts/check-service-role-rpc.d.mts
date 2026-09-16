/** Deklarasyon tip pou check-service-role-rpc.mjs. */

/** Yon migrasyon SQL, jan tchèk la li yo. */
export type MigrationInput = { file: string; sql: string };

/** Yon fichye sous TypeScript, jan tchèk la li yo. */
export type SourceInput = { file: string; code: string };

/** Yon apèl `supabaseAdmin.rpc()` sou yon fonksyon ki mande `auth.uid()`. */
export type Violation = {
  file: string;
  line: number;
  fn: string;
  /** Migrasyon kote dènye definisyon fonksyon an ye. */
  definedIn: string;
};

/** Yon ka konnen ki sote — wè kòmantè `KNOWN_PENDING` nan .mjs la. */
export type AllowlistEntry = { file: string; fn: string };

/**
 * Non fonksyon SQL ki sèvi `auth.uid()` SAN yo pa jere ka NULL la (kle ->
 * migrasyon ki defini l). Se yo ki pa ka rele ak service role.
 */
export function findUnsafeFunctions(migrations: MigrationInput[]): Map<string, string>;

/** Tout apèl `supabaseAdmin.rpc("non")` nan fichye yo. */
export function findServiceRoleRpcCalls(
  files: SourceInput[],
): { file: string; fn: string; line: number }[];

/** Lis vid = okenn apèl service role sou yon fonksyon `auth.uid()`. */
export function analyze(
  migrations: MigrationInput[],
  files: SourceInput[],
  allowlist?: AllowlistEntry[],
): Violation[];

/** Ka ki konnen, ki tann yon desizyon pwodwi — pa yon padon pèmanan. */
export const KNOWN_PENDING: AllowlistEntry[];

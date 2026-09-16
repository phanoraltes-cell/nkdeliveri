import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * GAD: YON APÈL `supabaseAdmin.rpc()` SOU YON FONKSYON KI MANDE `auth.uid()`.
 *
 * ---------------------------------------------------------------------------
 * KISA KI KASE
 *
 * `supabaseAdmin` sèvi kle SERVICE ROLE la. Nan kontèks sa a PA GEN JWT,
 * donk `auth.uid()` retounen NULL. Yon fonksyon ki gade otorizasyon konsa:
 *
 *     IF NOT (has_role(auth.uid(), 'admin')) THEN
 *       RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
 *     END IF;
 *
 * pa janm ka pase lè se service role ki rele l — `has_role(NULL, 'admin')`
 * toujou false. Se yon echèk DETÈMINIS: 100% nan apèl yo, depi premye jou a.
 *
 * ---------------------------------------------------------------------------
 * POUKISA YON GAD EPI PA JIS YON KOREKSYON
 *
 * Bug sa a te kache pandan lontan nan de kote alafwa, epi toude te bay yon
 * mesaj jeneral ki pa t di anyen:
 *
 *   - api.admin.ai.ts -> "Pa ka chaje done trafik yo."
 *     Asistan AI admin nan pa t janm mache yon sèl fwa.
 *
 *   - plop-wallet-topup-reconcile.server.ts -> yon kliyan ki peye, PLOP ki
 *     konfime, epi pòtfèy la ki pa janm kredite.
 *
 * Erè a pa parèt nan `npm run verify`, li pa parèt nan tès, li pa parèt nan
 * tsc — paske li se yon kontra ANT de lang (TypeScript ak SQL) ke okenn nan
 * de konpilatè yo pa wè. Se egzakteman kalite bagay yon gad estatik atrap.
 *
 * ---------------------------------------------------------------------------
 * KIJAN POU YON FONKSYON RETE KORÈK
 *
 * `check_rate_limit_secure` (20260713121500_rate_limiting.sql) montre bon
 * modèl la, epi kòmantè pa l esplike menm pyèj la:
 *
 *     IF auth.uid() IS NULL THEN
 *       IF _actor_override IS NULL THEN RAISE EXCEPTION ...;
 *       v_actor := _actor_override;      -- chemen service role
 *     ELSE
 *       v_actor := auth.uid()::text;     -- chemen itilizatè konekte
 *     END IF;
 *
 * Donk reg la: yon fonksyon ki sèvi `auth.uid()` epi ki JERE ka NULL la
 * eksplisitman se yon fonksyon ki ka rele ak service role. Youn ki pa jere
 * l, non. Se sa tchèk sa a mezire — pa prezans `auth.uid()` pou kont li,
 * sa ta bay 115 fo pozitif.
 *
 * DE FASON POU REPARE YON VYOLASYON:
 *   1. Rele RPC la ak kliyan itilizatè a (JWT li), pa `supabaseAdmin`. Se
 *      sa api.admin.ai.ts fè kounye a — zewo migrasyon.
 *   2. Si pa gen itilizatè ditou (yon travay otomatik), bay fonksyon an yon
 *      paramèt `_actor_override` jan `check_rate_limit_secure` genyen.
 */

const MIGRATIONS_DIR = "supabase/migrations";
const SRC_DIR = "src";

/**
 * Chèche nan migrasyon yo ki fonksyon ki sèvi `auth.uid()` SAN jere ka NULL
 * la. Dènye definisyon an genyen (yon `CREATE OR REPLACE` pita ka repare
 * oswa kase yon fonksyon).
 */
export function findUnsafeFunctions(migrations) {
  const state = new Map(); // non -> { unsafe, file }

  for (const { file, sql } of migrations) {
    const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:[a-z_]+\.)?([a-z0-9_]+)\s*\(/gi;
    let m;
    while ((m = re.exec(sql))) {
      const name = m[1];
      const after = sql.slice(m.index);
      const end = after.search(/\$\$\s*;/);
      const body = end === -1 ? after : after.slice(0, end + 2);

      if (!/auth\.uid\(\)/i.test(body)) {
        // Yon redefinisyon ki pa sèvi auth.uid() ditou: li san danje.
        state.set(name, { unsafe: false, file });
        continue;
      }

      // Li sèvi auth.uid(). Eske li jere ka service role la eksplisitman?
      // De fòm ki konte: yon tchèk NULL dirèk, oswa yon COALESCE sou yon
      // paramèt override.
      const handlesNull =
        /auth\.uid\(\)\s+IS\s+NULL/i.test(body) ||
        /COALESCE\s*\(\s*_[a-z0-9_]*(actor|user|admin|caller)[a-z0-9_]*\s*,\s*auth\.uid\(\)/i.test(
          body,
        );

      state.set(name, { unsafe: !handlesNull, file });
    }
  }

  const unsafe = new Map();
  for (const [name, v] of state) if (v.unsafe) unsafe.set(name, v.file);
  return unsafe;
}

/** Tout apèl `supabaseAdmin.rpc("non")` nan yon fichye. */
export function findServiceRoleRpcCalls(files) {
  const calls = [];
  for (const { file, code } of files) {
    const re = /supabaseAdmin\s*\.\s*rpc\(\s*["'`]([a-z0-9_]+)["'`]/gi;
    let m;
    while ((m = re.exec(code))) {
      calls.push({ file, fn: m[1], line: code.slice(0, m.index).split("\n").length });
    }
  }
  return calls;
}

/**
 * VYOLASYON KI KONNEN, KI TANN YON DESIZYON — PA YON PADON.
 *
 * `admin_recover_wallet_topup_secure` rele nan
 * plop-wallet-topup-reconcile.server.ts ak service role. Li kase, epi li
 * kase nan chemen lajan an: PLOP konfime yon peman, entansyon an te
 * ekspire pa erè, epi kredi pòtfèy la pa janm rive. (Erè a byen jounalize
 * — "RPC FAILED AFTER PLOP CONFIRMED" — donk li pa an silans, men rezilta
 * a se yon kliyan ki peye san li pa resevwa anyen.)
 *
 * POUKISA LI PA REPARE ISIT LA: se PA sèlman `auth.uid()`. Fonksyon an rele
 * tou `private.require_admin_step_up_strict()`. Sa vle di li te KONSTWI pou
 * yon admin imen k ap aji eksprè, ak yon step-up MFA — pa pou yon travay
 * otomatik. Bay li yon `_actor_override` pa t ap ase: step-up la ta echwe
 * apre. Epi retire step-up la ta febli yon kontwòl sou vrè lajan k ap antre
 * nan yon balans kliyan.
 *
 * Donk gen de chemen, epi se yon desizyon pwodwi, pa yon koreksyon teknik:
 *   a) rekonsilyatè a sispann eseye kredite pou kont li — li make ranje a
 *      epi yon admin fè rekiperasyon an nan UI a (sa fonksyon an te fèt
 *      pou li);
 *   b) yon dezyèm fonksyon, service role, san step-up — sa ki vle di aksepte
 *      yon kredi otomatik san kontwòl imen.
 *
 * Antre sa a pèmèt tchèk la kontinye pwoteje kont NOUVO ka pandan desizyon
 * an poko pran. Li sib yon sèl fichye ak yon sèl fonksyon: nenpòt lòt
 * kote ki fè menm erè a ap toujou fè tchèk la echwe.
 */
export const KNOWN_PENDING = [
  { file: "plop-wallet-topup-reconcile.server.ts", fn: "admin_recover_wallet_topup_secure" },
];

/** Fonksyon pi a: bay vyolasyon yo. Tès la rele sa a dirèkteman. */
export function analyze(migrations, files, allowlist = KNOWN_PENDING) {
  const unsafe = findUnsafeFunctions(migrations);
  const calls = findServiceRoleRpcCalls(files);
  return calls
    .filter((c) => unsafe.has(c.fn))
    .filter((c) => !allowlist.some((a) => c.file.endsWith(a.file) && c.fn === a.fn))
    .map((c) => ({ ...c, definedIn: unsafe.get(c.fn) }));
}

function readMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ file: f, sql: readFileSync(join(MIGRATIONS_DIR, f), "utf8") }));
}

/**
 * Tès yo EKSKLI espre. Tès tchèk sa a gen egzanp `supabaseAdmin.rpc(...)`
 * nan chèn karaktè — se fikti ki la pou pwouve reg la atrap yon vrè
 * vyolasyon. Si nou te eskane yo, tchèk la t ap siyale pwòp fikti li epi li
 * pa t ap janm ka pase. Yon fo pozitif isit la pi grav pase yon rate: yon
 * moun t ap jis retire tchèk la nan `verify`.
 */
function readSources(dir = SRC_DIR) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      out.push(...readSources(p));
    } else if (/\.(ts|tsx)$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
      out.push({ file: p, code: readFileSync(p, "utf8") });
    }
  }
  return out;
}

// Pa kouri lè se yon tès ki enpòte fichye a.
if (process.argv[1] && process.argv[1].endsWith("check-service-role-rpc.mjs")) {
  const migrations = readMigrations();
  const sources = readSources();
  const violations = analyze(migrations, sources);

  // Montre ka ki tann desizyon an CHAK FWA. Yon allowlist ki envizib se yon
  // allowlist tout moun bliye.
  const stillPending = analyze(migrations, sources, []).filter((v) =>
    KNOWN_PENDING.some((a) => v.file.endsWith(a.file) && v.fn === a.fn),
  );
  for (const v of stillPending) {
    console.warn(
      `[service-role-rpc] KONNEN, TANN DESIZYON: ${v.file}:${v.line} -> ${v.fn}() ` +
        `(chemen lajan — wè kòmantè KNOWN_PENDING)`,
    );
  }

  if (violations.length === 0) {
    console.log(
      `[service-role-rpc] okay — okenn NOUVO apèl service role sou yon fonksyon auth.uid()` +
        (stillPending.length ? ` (${stillPending.length} ka konnen anwo a)` : ""),
    );
    process.exit(0);
  }

  console.error("[service-role-rpc] VYOLASYON:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    supabaseAdmin.rpc("${v.fn}") — defini nan ${v.definedIn}`);
    console.error(`    auth.uid() ap NULL isit la, donk gad otorizasyon an ap leve 42501.\n`);
  }
  console.error(
    "  Repare: rele l ak kliyan itilizatè a, oswa bay fonksyon an yon _actor_override.",
  );
  process.exit(1);
}

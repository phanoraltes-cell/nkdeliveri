import { describe, expect, it } from "vitest";
import {
  analyze,
  findUnsafeFunctions,
  KNOWN_PENDING,
} from "../../../scripts/check-service-role-rpc.mjs";

/**
 * Yon tchèk ki pa ka echwe pa pwouve anyen. Tès sa yo pwouve de bagay
 * separe: (1) reg la atrap yon vrè vyolasyon, (2) li PA atrap modèl korèk
 * la — paske si li te bay fo pozitif, yon moun t ap jis retire l nan
 * `verify` epi nou t ap pèdi pwoteksyon an nèt.
 *
 * Bug orijinal la: `supabaseAdmin` sèvi kle service role, kote `auth.uid()`
 * se NULL. Yon fonksyon ki gade `has_role(auth.uid(), 'admin')` leve 42501
 * chak fwa. Asistan AI admin nan pa t janm mache — li te bay "Pa ka chaje
 * done trafik yo." depi premye jou a.
 */

const UNSAFE_SQL = `
CREATE OR REPLACE FUNCTION public.get_admin_ai_traffic_stats_secure(_period text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN '{}'::jsonb;
END;
$$;
`;

// Modèl korèk la, kopye sou check_rate_limit_secure.
const SAFE_OVERRIDE_SQL = `
CREATE OR REPLACE FUNCTION public.check_rate_limit_secure(_action text, _actor_override text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN
    IF _actor_override IS NULL THEN RAISE EXCEPTION 'actor required'; END IF;
    v_actor := _actor_override;
  ELSE
    v_actor := auth.uid()::text;
  END IF;
  RETURN true;
END;
$$;
`;

const NO_AUTH_UID_SQL = `
CREATE OR REPLACE FUNCTION public.complete_wallet_topup_secure(_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.payment_intents SET status = 'succeeded' WHERE external_reference = _ref;
END;
$$;
`;

const mig = (sql: string, file = "test.sql") => [{ file, sql }];
const src = (code: string, file = "src/routes/api.test.ts") => [{ file, code }];

describe("reg la atrap vrè vyolasyon an", () => {
  it("make yon fonksyon auth.uid() san gad NULL kòm danjere", () => {
    const unsafe = findUnsafeFunctions(mig(UNSAFE_SQL));
    expect(unsafe.has("get_admin_ai_traffic_stats_secure")).toBe(true);
  });

  it("atrap bug reyèl la: supabaseAdmin.rpc sou fonksyon sa a", () => {
    const code = `
      const { data } = await supabaseAdmin.rpc("get_admin_ai_traffic_stats_secure", {
        _period: period,
      });
    `;
    const found = analyze(mig(UNSAFE_SQL), src(code));
    expect(found).toHaveLength(1);
    expect(found[0].fn).toBe("get_admin_ai_traffic_stats_secure");
  });

  it("bay nimewo liy lan, pou yon moun jwenn li", () => {
    const code = `line one\nline two\nawait supabaseAdmin.rpc("get_admin_ai_traffic_stats_secure");`;
    expect(analyze(mig(UNSAFE_SQL), src(code))[0].line).toBe(3);
  });
});

describe("reg la PA bay fo pozitif", () => {
  it("yon fonksyon ki jere auth.uid() IS NULL ak _actor_override pase", () => {
    const unsafe = findUnsafeFunctions(mig(SAFE_OVERRIDE_SQL));
    expect(unsafe.has("check_rate_limit_secure")).toBe(false);

    const code = `await supabaseAdmin.rpc("check_rate_limit_secure", { _actor_override: userId });`;
    expect(analyze(mig(SAFE_OVERRIDE_SQL), src(code))).toHaveLength(0);
  });

  it("yon fonksyon ki pa sèvi auth.uid() ditou pase", () => {
    const code = `await supabaseAdmin.rpc("complete_wallet_topup_secure", { _ref: r });`;
    expect(analyze(mig(NO_AUTH_UID_SQL), src(code))).toHaveLength(0);
  });

  it("yon apèl ak kliyan itilizatè a pase — se KOREKSYON an", () => {
    // Se egzakteman sa api.admin.ai.ts fè kounye a.
    const code = `await scopedClient.rpc("get_admin_ai_traffic_stats_secure", { _period: p });`;
    expect(analyze(mig(UNSAFE_SQL), src(code))).toHaveLength(0);
  });

  it("yon CREATE OR REPLACE pita ki retire auth.uid() repare fonksyon an", () => {
    const migrations = [
      { file: "001.sql", sql: UNSAFE_SQL },
      {
        file: "002.sql",
        sql: `CREATE OR REPLACE FUNCTION public.get_admin_ai_traffic_stats_secure(_period text)
              RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
              BEGIN RETURN '{}'::jsonb; END;
              $$;`,
      },
    ];
    expect(findUnsafeFunctions(migrations).has("get_admin_ai_traffic_stats_secure")).toBe(false);
  });
});

describe("allowlist la", () => {
  it("sote sèlman ka ki nonmen an, pa tout fonksyon an", () => {
    const code = `await supabaseAdmin.rpc("get_admin_ai_traffic_stats_secure");`;
    const allow = [{ file: "lòt-fichye.ts", fn: "get_admin_ai_traffic_stats_secure" }];
    // Menm fonksyon, men yon LÒT fichye: li dwe toujou echwe.
    expect(analyze(mig(UNSAFE_SQL), src(code), allow)).toHaveLength(1);
  });

  it("kenbe ka chemen lajan an nan lis la jiskaske yon desizyon pran", () => {
    // Si yon moun repare l, tès sa a raple pou retire antre a tou.
    expect(KNOWN_PENDING).toHaveLength(1);
    expect(KNOWN_PENDING[0].fn).toBe("admin_recover_wallet_topup_secure");
  });
});

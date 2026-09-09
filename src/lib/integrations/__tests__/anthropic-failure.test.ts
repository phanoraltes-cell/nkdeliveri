import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { classifyAnthropicError, AiNotConfiguredError } from "../anthropic-failure";
import { FAILURE_STATUS } from "../failure";

/**
 * Chak tès isit la se yon ka reyèl ki te koute tan, oswa yon ka ki t ap
 * koute tan si nou pa t detekte l. Tès la ki konte plis se sa ki sou
 * fakturasyon an: se pàn nan ki te dire plizyè jou.
 */

/** Konstwi yon erè SDK ki gen menm fòm ak sa API a voye tout bon. */
function apiError(status: number, type: string, message: string) {
  return Anthropic.APIError.generate(
    status,
    { type: "error", error: { type, message } },
    message,
    new Headers({ "request-id": "req_test_123" }),
  );
}

describe("classifyAnthropicError — ka fakturasyon an (ensidan an)", () => {
  it("rekonèt yon kont san kredi MALGRE li rive kòm yon HTTP 400", () => {
    // Se tout pwoblèm nan: Anthropic voye sa a kòm `invalid_request_error`
    // ak estati 400 — menm klas SDK ak yon pwomt ki malfòme. Yon
    // klasifikasyon pa klas oswa pa estati rele l « move demand » epi voye
    // yon devlopè chèche yon bug nan pwomt la.
    const err = apiError(
      400,
      "invalid_request_error",
      "Your credit balance is too low to access the Anthropic API.",
    );
    const failure = classifyAnthropicError(err);

    expect(failure.kind).toBe("billing");
    expect(failure.status).toBe(402);
    expect(failure.message).toContain("Billing");
    expect(failure.message).toContain("kredi");
  });

  it("mesaj la di kote pou ale — pa « eseye ankò pita »", () => {
    // Yon kont san kredi p ap regle tèt li. Di yon moun tann se voye l
    // tann yon bagay ki p ap janm rive.
    const failure = classifyAnthropicError(
      apiError(400, "invalid_request_error", "Your credit balance is too low"),
    );
    expect(failure.message).toContain("console.anthropic.com");
    expect(failure.message).not.toMatch(/eseye ankò/i);
  });

  it("yon vrè move demand rete yon erè founisè, pa yon pwoblèm fakturasyon", () => {
    const failure = classifyAnthropicError(
      apiError(400, "invalid_request_error", "max_tokens: must be greater than 0"),
    );
    expect(failure.kind).toBe("provider_error");
  });
});

describe("classifyAnthropicError — lòt kòz yo", () => {
  it("kle ki manke nan anviwònman an", () => {
    const failure = classifyAnthropicError(new AiNotConfiguredError());
    expect(failure.kind).toBe("not_configured");
    expect(failure.status).toBe(503);
    expect(failure.message).toContain("ANTHROPIC_API_KEY");
  });

  it("kle envalid oswa revoke", () => {
    const failure = classifyAnthropicError(
      apiError(401, "authentication_error", "invalid x-api-key"),
    );
    expect(failure.kind).toBe("invalid_credentials");
    expect(failure.status).toBe(401);
  });

  it("modèl ki pa egziste", () => {
    const failure = classifyAnthropicError(
      apiError(404, "not_found_error", "model: claude-pa-egziste"),
    );
    expect(failure.kind).toBe("not_found");
    expect(failure.message).toContain("ANTHROPIC_MODEL_FAST");
  });

  it("kota depase (429)", () => {
    const failure = classifyAnthropicError(apiError(429, "rate_limit_error", "rate limit"));
    expect(failure.kind).toBe("rate_limited");
    expect(failure.status).toBe(429);
  });

  it("tan mouri", () => {
    const failure = classifyAnthropicError(new Anthropic.APIConnectionTimeoutError({}));
    expect(failure.kind).toBe("timeout");
    expect(failure.status).toBe(504);
  });

  it("rezo ki tonbe", () => {
    const failure = classifyAnthropicError(new Anthropic.APIConnectionError({ message: "fetch" }));
    expect(failure.kind).toBe("network");
  });

  it("yon erè ki pa soti nan SDK a pa kraze klasifikatè a", () => {
    const failure = classifyAnthropicError(new Error("yon bagay lòt"));
    expect(failure.kind).toBe("provider_error");
    expect(failure.status).toBe(502);
  });
});

describe("done pou jounal la", () => {
  it("kenbe kòd founisè a ak request_id — se sa sipò a mande", () => {
    const failure = classifyAnthropicError(
      apiError(401, "authentication_error", "invalid x-api-key"),
    );
    expect(failure.providerCode).toBe("authentication_error");
    expect(failure.requestId).toBe("req_test_123");
  });

  it("detay teknik la separe de mesaj moun nan wè a", () => {
    const failure = classifyAnthropicError(
      apiError(400, "invalid_request_error", "Your credit balance is too low"),
    );
    expect(failure.detail).toContain("credit balance");
    // Mesaj la se yon enstriksyon, pa yon mesaj founisè an anglè.
    expect(failure.message).not.toContain("credit balance is too low");
  });
});

describe("FAILURE_STATUS", () => {
  it("okenn kategori pa mape sou 500 — yon founisè ki tonbe pa yon bug lakay nou", () => {
    for (const status of Object.values(FAILURE_STATUS)) {
      expect(status).not.toBe(500);
    }
  });
});

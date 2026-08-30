// TACH 2 (NOTIFIKASYON — SMS KÒM SEKOU) — kouch abstraksyon, pa kole ak yon
// sèl founisè. Idantifyan yo (SID/token/nimewo egzedan) TOUJOU nan varyab
// anviwònman, JAMÈ nan kòd frontend/backend la — wè `env` anba a.
//
// `SMS_PROVIDER` deside ki enplemantasyon reyèl la itilize:
//   - "none" (default, si okenn varyab pa konfigire) — yon "no-op" ki jis
//     log epi retounen echèk pwòp, pou pa gen okenn eksepsyon ki kraze yon
//     flux (kreyasyon kòmand, siyalman, elatriye) si SMS pa konfigire
//     ankò. Sa a se konpòtman PA DEFO — pwodwi a kontinye mache san SMS
//     jiskaske Altes mete yon vrè founisè.
//   - "twilio" — egzanp konkrè yon founisè REYÈL, aktive sèlman si
//     TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER prezan.
//
// Ajoute yon lòt founisè pita se yon nouvo branch nan `getSmsProvider()`
// sèlman — okenn lòt fichye pa bezwen chanje (sms-dispatch.server.ts pale
// ak entèfas `SmsProvider` la sèlman, jamè ak yon founisè espesifik).

export type SmsSendResult = { ok: true } | { ok: false; error: string };

export type SmsProvider = {
  name: string;
  send(to: string, body: string): Promise<SmsSendResult>;
};

const NOOP_PROVIDER: SmsProvider = {
  name: "none",
  async send(to, body) {
    console.warn(
      `[sms] SMS_PROVIDER pa konfigire — mesaj pa voye reyèlman (to=${to.slice(0, 4)}***, ${body.length} karaktè).`,
    );
    return { ok: false, error: "SMS pa konfigire" };
  },
};

/**
 * Twilio REST API dirèk (fetch), pa SDK Node Twilio a — evite ajoute yon
 * nouvo dependency lou pou yon apèl HTTP senp (spec la mande "pa ajoute
 * dependency nouvo si li pa nesesè").
 */
function makeTwilioProvider(): SmsProvider {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_FROM_NUMBER!;
  return {
    name: "twilio",
    async send(to, body) {
      try {
        const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
        const params = new URLSearchParams({ To: to, From: from, Body: body });
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: {
              Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "SMS send failed" };
      }
    },
  };
}

export function getSmsProvider(): SmsProvider {
  const kind = process.env.SMS_PROVIDER || "none";
  if (
    kind === "twilio" &&
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM_NUMBER
  ) {
    return makeTwilioProvider();
  }
  return NOOP_PROVIDER;
}

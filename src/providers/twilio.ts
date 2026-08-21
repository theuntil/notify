import { config } from "../config.js";

const BASE = "https://api.twilio.com/2010-04-01";
const VERIFY_BASE = "https://verify.twilio.com/v2";

function authHeader(): string {
  const raw = `${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`;
  return `Basic ${Buffer.from(raw).toString("base64")}`;
}

async function twilioFetch(url: string, body: URLSearchParams) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.TWILIO_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok) {
      return {
        ok: false as const,
        code: String(json.code ?? res.status),
        message: String(json.message ?? "Twilio isteği başarısız"),
      };
    }
    return { ok: true as const, data: json };
  } catch (err) {
    const aborted = (err as Error).name === "AbortError";
    return {
      ok: false as const,
      code: aborted ? "timeout" : "network_error",
      message: aborted ? "Twilio zaman aşımı" : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify modu: kodu Twilio üretir ve doğrular.
 * Numara satın almaya gerek yok — Twilio Verify servisi yeterli.
 */
export async function verifyStart(phone: string, locale = "tr") {
  const body = new URLSearchParams({ To: phone, Channel: "sms", Locale: locale });
  const res = await twilioFetch(
    `${VERIFY_BASE}/Services/${config.TWILIO_VERIFY_SERVICE_SID}/Verifications`,
    body,
  );
  if (!res.ok) return res;
  return { ok: true as const, sid: String(res.data.sid ?? ""), status: String(res.data.status ?? "") };
}

export async function verifyCheck(phone: string, code: string) {
  const body = new URLSearchParams({ To: phone, Code: code });
  const res = await twilioFetch(
    `${VERIFY_BASE}/Services/${config.TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`,
    body,
  );
  if (!res.ok) {
    // 20404: doğrulama kaydı bulunamadı veya süresi dolmuş
    if (res.code === "20404") return { ok: true as const, approved: false, expired: true };
    return res;
  }
  return {
    ok: true as const,
    approved: String(res.data.status ?? "") === "approved",
    expired: false,
  };
}

/** Messaging modu: kodu biz üretiriz, Twilio yalnızca SMS'i iletir */
export async function sendSms(phone: string, text: string) {
  const body = new URLSearchParams({
    To: phone,
    From: config.TWILIO_FROM_NUMBER ?? "",
    Body: text,
  });
  const res = await twilioFetch(
    `${BASE}/Accounts/${config.TWILIO_ACCOUNT_SID}/Messages.json`,
    body,
  );
  if (!res.ok) return res;
  return { ok: true as const, sid: String(res.data.sid ?? "") };
}

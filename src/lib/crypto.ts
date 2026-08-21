import { createHmac, randomInt, timingSafeEqual, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

/** OTP kodu — kriptografik rastgelelik (Math.random DEĞİL) */
export function generateOtp(length = config.OTP_LENGTH): string {
  let out = "";
  for (let i = 0; i < length; i++) out += randomInt(0, 10).toString();
  return out;
}

/** OTP asla düz metin saklanmaz; veritabanı sızsa bile kodlar kullanılamaz */
export function hashOtp(code: string, salt: string): string {
  return createHmac("sha256", config.OTP_PEPPER).update(`${salt}:${code}`).digest("hex");
}

/** Zamanlama saldırısına kapalı karşılaştırma */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba); // uzunluk farkı da sabit maliyetli olsun
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Telefon/e-posta düz metin saklanmaz */
export function hashTarget(target: string): string {
  return createHmac("sha256", config.OTP_PEPPER).update(target.toLowerCase()).digest("hex");
}

/** IP ham tutulmaz */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${config.OTP_PEPPER}:${ip}`).digest("hex").slice(0, 32);
}

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

/**
 * İstek imzası doğrulaması.
 * Site her isteği paylaşılan sırla imzalar. Servis internete açık olsa bile
 * yalnızca imzayı üretebilen taraf (site) kullanabilir.
 */
export function verifySignature(p: {
  timestamp: string; nonce: string; method: string; path: string; body: string; signature: string;
}): { ok: true } | { ok: false; reason: string } {
  const ts = Number(p.timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid_timestamp" };

  const drift = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (drift > config.SIGNATURE_TOLERANCE_SEC) return { ok: false, reason: "timestamp_out_of_range" };

  if (!p.nonce || p.nonce.length < 16 || p.nonce.length > 128) {
    return { ok: false, reason: "invalid_nonce" };
  }

  const payload = [
    p.timestamp, p.nonce, p.method.toUpperCase(), p.path,
    createHash("sha256").update(p.body).digest("hex"),
  ].join("\n");

  const expected = createHmac("sha256", config.SERVICE_SECRET).update(payload).digest("hex");
  return safeEqual(expected, p.signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

/** İstemci tarafı imzalama (Next.js de aynı mantığı kullanır) */
export function signRequest(secret: string, method: string, path: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString("hex");
  const payload = [
    timestamp, nonce, method.toUpperCase(), path,
    createHash("sha256").update(body).digest("hex"),
  ].join("\n");
  return {
    timestamp, nonce,
    signature: createHmac("sha256", secret).update(payload).digest("hex"),
  };
}

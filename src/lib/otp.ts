import { config } from "../config.js";
import { query } from "./db.js";
import { generateOtp, hashOtp, hashTarget, newSalt, safeEqual } from "./crypto.js";
import { checkSendLimits, isBlocked } from "./ratelimit.js";
import * as twilio from "../providers/twilio.js";
import { sendMail } from "../providers/smtp.js";
import { templates } from "../templates/index.js";

export type Channel = "sms" | "email";
export type Purpose = "phone_verify" | "email_verify" | "password_reset" | "login" | "sensitive_action";

/** Telefon: +90 5xx *** ** 12 · E-posta: ab***@ornek.com */
export function maskTarget(channel: Channel, target: string): string {
  if (channel === "sms") {
    return target.replace(/^(\+\d{2})(\d{3})(\d{3})(\d{2})(\d{2})$/, "$1 $2 *** ** $5");
  }
  const [user = "", domain = ""] = target.split("@");
  const head = user.slice(0, 2);
  return `${head}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
}

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("5")) return `+90${digits}`;
  if (digits.length === 11 && digits.startsWith("05")) return `+90${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("90")) return `+${digits}`;
  if (input.startsWith("+") && digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254 ? e : null;
}

interface SendResult {
  ok: boolean;
  requestId?: string;
  maskedTarget?: string;
  expiresAt?: string;
  resendAfterSec?: number;
  error?: string;
  code?: string;
}

/** Yeni doğrulama kodu oluştur ve gönder */
export async function sendOtp(params: {
  channel: Channel;
  purpose: Purpose;
  target: string;
  ipHash: string;
  userAgentHash?: string;
  meta?: Record<string, unknown>;
  /**
   * true ise kod ÜRETİLİR ve kaydedilir ama GÖNDERİLMEZ.
   * Kayıtlı olmayan adrese şifre sıfırlama istendiğinde kullanılır:
   * gereksiz e-posta gitmez, ama yanıt aynı kaldığı için
   * saldırgan hangi adresin kayıtlı olduğunu anlayamaz.
   */
  silent?: boolean;
}): Promise<SendResult> {
  const { channel, purpose, target, ipHash } = params;
  const targetHash = hashTarget(target);

  if (await isBlocked(targetHash)) {
    return { ok: false, code: "blocked", error: "Bu adres/numara geçici olarak engellendi." };
  }

  // Aynı hedefe çok sık gönderim: soğuma süresi
  const { rows: recent } = await query<{ created_at: Date }>(
    `select created_at from notify.otp_requests
      where target_hash = $1 and purpose = $2 and status = 'pending'
      order by created_at desc limit 1`,
    [targetHash, purpose],
  );

  const last = recent[0]?.created_at;
  if (last) {
    const elapsed = (Date.now() - new Date(last).getTime()) / 1000;
    if (elapsed < config.OTP_RESEND_COOLDOWN_SEC) {
      return {
        ok: false,
        code: "cooldown",
        error: "Çok sık kod istediniz. Lütfen biraz bekleyin.",
        resendAfterSec: Math.ceil(config.OTP_RESEND_COOLDOWN_SEC - elapsed),
      };
    }
  }

  const limits = await checkSendLimits(targetHash, ipHash);
  if (!limits.allowed) {
    return {
      ok: false,
      code: "rate_limited",
      error: "Çok fazla doğrulama isteği gönderildi. Lütfen daha sonra tekrar deneyin.",
    };
  }

  // Aynı hedef+amaç için bekleyen eski kodları iptal et (tek aktif kod kuralı)
  await query(
    `update notify.otp_requests set status = 'cancelled'
      where target_hash = $1 and purpose = $2 and status = 'pending'`,
    [targetHash, purpose],
  );

  const masked = maskTarget(channel, target);
  const expiresAt = new Date(Date.now() + config.OTP_TTL_SEC * 1000);
  const useTwilioVerify =
    channel === "sms" && config.TWILIO_ENABLED && config.TWILIO_MODE === "verify" && !params.silent;

  let codeHash: string | null = null;
  let salt: string | null = null;
  let providerRef: string | null = null;
  let provider = "internal";
  const started = Date.now();

  if (params.silent) {
    // Sessiz mod: kayıt oluşur, gönderim yapılmaz.
    // Yanıt gerçek gönderimle birebir aynı görünür.
    const code = generateOtp();
    salt = newSalt();
    codeHash = hashOtp(code, salt);
    provider = "silent";
    await logDelivery(channel, purpose, targetHash, "rejected", "silent", "unregistered", 0);
  } else if (useTwilioVerify) {
    // Kodu Twilio üretir ve doğrular; bizde kod hiç bulunmaz
    const res = await twilio.verifyStart(target);
    if (!res.ok) {
      await logDelivery(channel, purpose, targetHash, "failed", "twilio", res.code, Date.now() - started);
      return { ok: false, code: "provider_error", error: "SMS gönderilemedi. Lütfen tekrar deneyin." };
    }
    provider = "twilio_verify";
    providerRef = res.sid;
  } else {
    const code = generateOtp();
    salt = newSalt();
    codeHash = hashOtp(code, salt);

    if (channel === "sms") {
      if (!config.TWILIO_ENABLED) {
        return { ok: false, code: "sms_disabled", error: "SMS gönderimi kapalı." };
      }
      const text = `${config.SITE_NAME} doğrulama kodunuz: ${code}. ${Math.floor(config.OTP_TTL_SEC / 60)} dakika geçerlidir. Kodu kimseyle paylaşmayın.`;
      const res = await twilio.sendSms(target, text);
      if (!res.ok) {
        await logDelivery(channel, purpose, targetHash, "failed", "twilio", res.code, Date.now() - started);
        return { ok: false, code: "provider_error", error: "SMS gönderilemedi." };
      }
      provider = "twilio_sms";
      providerRef = res.sid;
    } else {
      const ttlMinutes = Math.floor(config.OTP_TTL_SEC / 60);
      const tpl =
        purpose === "password_reset" ? templates.password_reset({ code, ttlMinutes })
        : purpose === "login" ? templates.login_code({ code, ttlMinutes })
        : templates.email_verify({ code, ttlMinutes });

      const res = await sendMail({ to: target, subject: tpl.subject, html: tpl.html, text: tpl.text });
      if (!res.ok) {
        await logDelivery(channel, purpose, targetHash, "failed", "smtp", res.code, Date.now() - started);
        return { ok: false, code: "provider_error", error: "E-posta gönderilemedi." };
      }
      provider = "smtp";
      providerRef = res.messageId ?? null;
    }
  }

  const { rows } = await query<{ id: string }>(
    `insert into notify.otp_requests
       (channel, purpose, target_hash, target_masked, code_hash, code_salt,
        provider, provider_ref, max_attempts, ip_hash, user_agent_hash, meta, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     returning id`,
    [channel, purpose, targetHash, masked, codeHash, salt, provider, providerRef,
     config.OTP_MAX_ATTEMPTS, params.ipHash, params.userAgentHash ?? null,
     JSON.stringify(params.meta ?? {}), expiresAt],
  );

  await logDelivery(channel, purpose, targetHash, "sent", provider, null, Date.now() - started);

  return {
    ok: true,
    requestId: rows[0]?.id,
    maskedTarget: masked,
    expiresAt: expiresAt.toISOString(),
    resendAfterSec: config.OTP_RESEND_COOLDOWN_SEC,
  };
}

interface VerifyResult {
  ok: boolean;
  verified?: boolean;
  attemptsLeft?: number;
  error?: string;
  code?: string;
  purpose?: Purpose;
  maskedTarget?: string;
}

/** Kodu doğrula */
export async function verifyOtp(params: {
  requestId: string;
  code: string;
  target: string;
}): Promise<VerifyResult> {
  const targetHash = hashTarget(params.target);

  const { rows } = await query<{
    id: string; channel: Channel; purpose: Purpose; target_hash: string; target_masked: string;
    code_hash: string | null; code_salt: string | null; provider: string;
    attempts: number; max_attempts: number; status: string; expires_at: Date;
  }>(
    `select * from notify.otp_requests where id = $1`,
    [params.requestId],
  );

  const row = rows[0];

  // Kayıt yok, hedef eşleşmiyor veya durum uygun değil — hepsine aynı yanıt.
  // Saldırgana hangi aşamada takıldığı bilgisini vermiyoruz.
  if (!row || row.target_hash !== targetHash) {
    return { ok: false, code: "invalid", error: "Kod geçersiz veya süresi dolmuş." };
  }

  if (row.status === "verified") {
    return { ok: false, code: "already_used", error: "Bu kod zaten kullanıldı." };
  }

  // Deneme hakkı tükenmiş kayıt "süresi doldu" değil, doğru sebebi bildirmeli
  if (row.status === "failed") {
    return { ok: false, code: "too_many_attempts", error: "Çok fazla yanlış deneme. Yeni kod isteyin." };
  }

  if (row.status === "cancelled") {
    return { ok: false, code: "invalid", error: "Kod geçersiz. Yeni kod isteyin." };
  }

  if (row.status !== "pending" || new Date(row.expires_at).getTime() < Date.now()) {
    await query(`update notify.otp_requests set status='expired' where id=$1 and status='pending'`, [row.id]);
    return { ok: false, code: "expired", error: "Kodun süresi doldu. Yeni kod isteyin." };
  }

  if (row.attempts >= row.max_attempts) {
    await query(`update notify.otp_requests set status='failed' where id=$1`, [row.id]);
    return { ok: false, code: "too_many_attempts", error: "Çok fazla yanlış deneme. Yeni kod isteyin." };
  }

  // Denemeyi önce say — doğrulama başarısız olsa da sayaç artmalı
  const { rows: bumped } = await query<{ attempts: number }>(
    `update notify.otp_requests set attempts = attempts + 1 where id = $1 returning attempts`,
    [row.id],
  );
  const attempts = bumped[0]?.attempts ?? row.attempts + 1;
  const attemptsLeft = Math.max(row.max_attempts - attempts, 0);

  let approved = false;

  if (row.provider === "twilio_verify") {
    const res = await twilio.verifyCheck(params.target, params.code);
    if (!res.ok) return { ok: false, code: "provider_error", error: "Doğrulama yapılamadı." };
    approved = res.approved;
  } else {
    if (!row.code_hash || !row.code_salt) {
      return { ok: false, code: "invalid", error: "Kod geçersiz." };
    }
    approved = safeEqual(row.code_hash, hashOtp(params.code, row.code_salt));
  }

  if (!approved) {
    if (attemptsLeft === 0) {
      await query(`update notify.otp_requests set status='failed' where id=$1`, [row.id]);
      return { ok: false, code: "too_many_attempts", error: "Çok fazla yanlış deneme. Yeni kod isteyin." };
    }
    return { ok: false, code: "wrong_code", error: "Kod hatalı.", attemptsLeft };
  }

  await query(
    `update notify.otp_requests set status='verified', verified_at=now() where id=$1`,
    [row.id],
  );

  return {
    ok: true, verified: true,
    purpose: row.purpose,
    maskedTarget: row.target_masked,
  };
}

async function logDelivery(
  channel: string, template: string, targetHash: string,
  status: "sent" | "failed" | "rejected", provider: string,
  errorCode: string | null, durationMs: number,
) {
  try {
    await query(
      `insert into notify.delivery_log (channel, template, target_hash, status, provider, error_code, duration_ms)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [channel, template, targetHash, status, provider, errorCode, durationMs],
    );
  } catch {
    // Kayıt tutulamazsa akış durmasın
  }
}

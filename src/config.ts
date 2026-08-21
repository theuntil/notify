import { z } from "zod";

/**
 * Ortam değişkenleri açılışta doğrulanır.
 * Eksik veya hatalı bir değer varsa servis hiç başlamaz — üretimde
 * yarım yapılandırmayla sessizce hatalı çalışmasındansa çökmesi iyidir.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL zorunlu"),
  DB_SCHEMA: z.string().default("notify"),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  SERVICE_SECRET: z.string().min(32, "SERVICE_SECRET en az 32 karakter olmalı"),
  SIGNATURE_TOLERANCE_SEC: z.coerce.number().int().positive().default(300),
  ALLOWED_ORIGINS: z.string().default(""),

  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SEC: z.coerce.number().int().positive().default(60),
  OTP_PEPPER: z.string().min(16, "OTP_PEPPER en az 16 karakter olmalı"),

  RATE_PER_TARGET_HOUR: z.coerce.number().int().positive().default(5),
  RATE_PER_TARGET_DAY: z.coerce.number().int().positive().default(15),
  RATE_PER_IP_HOUR: z.coerce.number().int().positive().default(20),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.string().default("true").transform((v) => v !== "false"),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM_NAME: z.string().default("Çocuk Tribünü"),
  SMTP_FROM_EMAIL: z.string().email(),

  TWILIO_ENABLED: z.string().default("true").transform((v) => v !== "false"),
  TWILIO_MODE: z.enum(["verify", "messaging"]).default("verify"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_VERIFY_SERVICE_SID: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  TWILIO_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),

  SITE_URL: z.string().url().default("https://cocuktribunu.org"),
  // E-posta logolarının çözümlenmesi için Supabase genel adresi
  SUPABASE_PUBLIC_URL: z.string().optional(),
  SITE_NAME: z.string().default("Çocuk Tribünü"),
  SUPPORT_EMAIL: z.string().email().default("iletisim@cocuktribunu.com"),

  /* ── Zamanlanmış görevler ──
     Kart süre uyarıları günde bir kez çalışır. Kapatmak için
     SCHEDULER_ENABLED=false yeterlidir; servis normal çalışmaya devam eder. */
  SCHEDULER_ENABLED: z.string().default("true").transform((v) => v !== "false"),
  /** Günün saati (0–23), sunucu saatiyle. Varsayılan 09:00. */
  SCHEDULER_HOUR: z.coerce.number().int().min(0).max(23).default(9),
  /** Kaç gün kala uyarı gönderilsin */
  EXPIRY_WARNING_DAYS: z.coerce.number().int().min(1).max(60).default(7),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  · ${i.path.join(".")}: ${i.message}`).join("\n");
  console.error(`\nOrtam değişkenlerinde hata var, servis başlatılmıyor:\n${issues}\n`);
  process.exit(1);
}

export const config = parsed.data;

if (config.TWILIO_ENABLED) {
  const missing: string[] = [];
  if (!config.TWILIO_ACCOUNT_SID) missing.push("TWILIO_ACCOUNT_SID");
  if (!config.TWILIO_AUTH_TOKEN) missing.push("TWILIO_AUTH_TOKEN");
  if (config.TWILIO_MODE === "verify" && !config.TWILIO_VERIFY_SERVICE_SID) {
    missing.push("TWILIO_VERIFY_SERVICE_SID");
  }
  if (config.TWILIO_MODE === "messaging" && !config.TWILIO_FROM_NUMBER) {
    missing.push("TWILIO_FROM_NUMBER");
  }
  if (missing.length > 0) {
    console.error(`\nTWILIO_ENABLED=true ama şunlar eksik: ${missing.join(", ")}\n`);
    process.exit(1);
  }
}

export const allowedOrigins = config.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);

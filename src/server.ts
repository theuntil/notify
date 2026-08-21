import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";

import { config, allowedOrigins } from "./config.js";
import { pool, query, healthcheck } from "./lib/db.js";
import { hashIp, verifySignature } from "./lib/crypto.js";
import { runDailyCardJobs, startScheduler, stopScheduler } from "./lib/scheduler.js";
import { consumeNonce } from "./lib/ratelimit.js";
import { sendOtp, verifyOtp, normalizePhone, normalizeEmail } from "./lib/otp.js";
import { templates, type TemplateName } from "./templates/index.js";
import { sendMail, sendRawMail, verifyTransport } from "./providers/smtp.js";
import { refreshBranding } from "./lib/branding.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    // Gizli bilgiler log'a asla düşmesin
    // Üretimde her isteği loglamıyoruz; yalnızca hatalar ve uyarılar
    ...(config.NODE_ENV === "production" ? { logController: { disableRequestLogging: true } } : {}),
    redact: {
      paths: [
        "req.headers.authorization", "req.headers['x-signature']",
        "req.body.target", "req.body.code", "req.body.to", "req.body.params",
      ],
      censor: "[gizlendi]",
    },
  },
  trustProxy: true,
  /* Gövde sınırı 512 KB.
     Eskiden 64 KB idi; yönetim panelinden gönderilen tam HTML mail
     (üst görsel, logo, tablo düzeni, imza) bu sınırı aşıyor ve istek
     sessizce 413 dönüyordu. Doğrulama kodları küçük olduğu için sorun
     görülmemişti. */
  bodyLimit: 512 * 1024,
});

/* ─────────────── Güvenlik katmanları ─────────────── */

await app.register(helmet, { contentSecurityPolicy: false });

await app.register(cors, {
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  methods: ["POST", "GET"],
  credentials: false,
});

// Kaba kuvvet için son savunma hattı (imza doğrulamasından bağımsız)
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  keyGenerator: (req) => req.ip,
  errorResponseBuilder: () => ({
    ok: false, code: "rate_limited",
    error: "Çok fazla istek gönderildi. Lütfen biraz bekleyin.",
  }),
});

/**
 * Ham gövdeyi imza doğrulaması için yakala.
 * İmza gövdenin BAYT BAYT aynısı üzerinden hesaplandığı için yeniden
 * JSON.stringify yapmak yanlış olur (anahtar sırası değişebilir).
 */
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body, done) => {
    (req as { rawBodyString?: string }).rawBodyString = typeof body === "string" ? body : "";
    if (!body) return done(null, {});
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error("Geçersiz JSON"), { statusCode: 400 }), undefined);
    }
  },
);

/**
 * İmza doğrulaması.
 * Sağlık kontrolü dışındaki tüm uçlar imza ister; imzasız istek 401 döner.
 */
app.addHook("preValidation", async (req, reply) => {
  if (req.url === "/health" || req.url === "/health/deep") return;

  const timestamp = req.headers["x-timestamp"];
  const nonce = req.headers["x-nonce"];
  const signature = req.headers["x-signature"];

  if (typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string") {
    return reply.code(401).send({ ok: false, code: "unauthorized", error: "İmza başlıkları eksik." });
  }

  const body = (req as { rawBodyString?: string }).rawBodyString ?? "";
  const path = req.url.split("?")[0] ?? req.url;

  const result = verifySignature({
    timestamp, nonce, method: req.method, path, body, signature,
  });

  if (!result.ok) {
    req.log.warn({ reason: result.reason, path }, "imza doğrulanamadı");
    return reply.code(401).send({ ok: false, code: "unauthorized", error: "İstek doğrulanamadı." });
  }

  // Aynı nonce ikinci kez kullanılamaz — yakalanan istek tekrar oynatılamaz
  if (!(await consumeNonce(nonce))) {
    return reply.code(401).send({ ok: false, code: "replay", error: "İstek tekrarı reddedildi." });
  }
});

/* ─────────────── Sağlık ─────────────── */

app.get("/health", async () => ({ ok: true, service: "ct-notify", ts: new Date().toISOString() }));

app.get("/health/deep", async (_req, reply) => {
  const [db, smtp] = await Promise.all([healthcheck(), verifyTransport()]);
  const ok = db && smtp.ok;
  return reply.code(ok ? 200 : 503).send({
    ok,
    database: db ? "up" : "down",
    smtp: smtp.ok ? "up" : `down: ${smtp.error}`,
    twilio: config.TWILIO_ENABLED ? `enabled (${config.TWILIO_MODE})` : "disabled",
  });
});

/* ─────────────── OTP ─────────────── */

const sendSchema = z.object({
  channel: z.enum(["sms", "email"]),
  purpose: z.enum(["phone_verify", "email_verify", "password_reset", "login", "sensitive_action"]),
  target: z.string().min(3).max(254),
  meta: z.record(z.string(), z.unknown()).optional(),
  // Kayıtlı olmayan hedefe gönderim yapılmasın ama yanıt aynı kalsın
  silent: z.boolean().optional(),
});

app.post("/v1/otp/send", async (req, reply) => {
  const parsed = sendSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, code: "bad_request", error: "Geçersiz istek." });
  }

  const { channel, purpose, target, meta, silent } = parsed.data;

  const normalized = channel === "sms" ? normalizePhone(target) : normalizeEmail(target);
  if (!normalized) {
    return reply.code(400).send({
      ok: false, code: "invalid_target",
      error: channel === "sms" ? "Telefon numarası geçersiz." : "E-posta adresi geçersiz.",
    });
  }

  await refreshBranding();

  const result = await sendOtp({
    channel, purpose, target: normalized,
    ipHash: hashIp(req.ip),
    userAgentHash: req.headers["user-agent"] ? hashIp(String(req.headers["user-agent"])) : undefined,
    meta,
    silent,
  });

  if (!result.ok) {
    const status = result.code === "rate_limited" || result.code === "cooldown" ? 429 : 400;
    return reply.code(status).send(result);
  }

  return result;
});

const verifySchema = z.object({
  requestId: z.string().uuid(),
  code: z.string().regex(/^\d{4,8}$/, "Kod 4-8 haneli olmalı"),
  target: z.string().min(3).max(254),
});

app.post("/v1/otp/verify", async (req, reply) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, code: "bad_request", error: "Geçersiz istek." });
  }

  const { requestId, code, target } = parsed.data;
  const normalized = normalizePhone(target) ?? normalizeEmail(target);
  if (!normalized) {
    return reply.code(400).send({ ok: false, code: "invalid_target", error: "Hedef geçersiz." });
  }

  const result = await verifyOtp({ requestId, code, target: normalized });
  return reply.code(result.ok ? 200 : 400).send(result);
});

/* ─────────────── İşlemsel e-posta ─────────────── */

const mailSchema = z.object({
  to: z.string().email(),
  template: z.enum([
    "welcome", "order_received", "payment_approved", "event_reminder",
    "invoice_ready", "order_cancelled",
    "card_ready", "card_expiring", "card_expired", "card_renewed",
    "email_change",
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
});

app.post("/v1/email/send", async (req, reply) => {
  const parsed = mailSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, code: "bad_request", error: "Geçersiz istek." });
  }

  const { to, template, params } = parsed.data;

  // Logo ayarı değişmişse yakala (5 dakikada bir yenilenir)
  await refreshBranding();

  try {
    const render = templates[template as TemplateName] as (p: Record<string, unknown>) => {
      subject: string; html: string; text: string;
    };
    const content = render(params);

    const res = await sendMail({
      to, subject: content.subject, html: content.html, text: content.text,
    });

    if (!res.ok) {
      req.log.error({ template, code: res.code }, "e-posta gönderilemedi");
      return reply.code(502).send({ ok: false, code: "send_failed", error: "E-posta gönderilemedi." });
    }

    return { ok: true, messageId: res.messageId };
  } catch (err) {
    req.log.error({ err, template }, "şablon hatası");
    return reply.code(400).send({ ok: false, code: "template_error", error: "Şablon işlenemedi." });
  }
});

/**
 * HAM MAİL GÖNDERİMİ
 *
 * Yönetim panelinin mail modülü kullanır. Şablon BURADA üretilmez —
 * panel tam HTML'i hazır gönderir; bu uç yalnızca SMTP taşıyıcısıdır.
 *
 * ★ NEDEN AYRI UÇ: /v1/email/send sabit şablon listesiyle çalışıyor
 *   (welcome, order_received…). Panelden yazılan serbest metin o listeye
 *   sığmıyor. Şablonlu uç olduğu gibi korunuyor; ikisi karışmıyor.
 *
 * ★ Gönderen adresi İSTEKTEN gelebilir ama yalnızca yapılandırılmış
 *   alan adıyla eşleşiyorsa. Aksi hâlde SMTP_FROM_EMAIL kullanılır —
 *   sunucumuz başkasının adına mail gönderen bir röleye dönüşmesin.
 */
const rawMailSchema = z.object({
  to: z.string().email(),
  toName: z.string().max(120).optional(),
  subject: z.string().min(1).max(300),
  html: z.string().min(1).max(400_000),
  text: z.string().max(200_000).optional(),
  fromEmail: z.string().email().optional(),
  fromName: z.string().max(120).optional(),
  replyTo: z.string().email().optional(),
});

app.post("/v1/email/raw", async (req, reply) => {
  const parsed = rawMailSchema.safeParse(req.body);
  if (!parsed.success) {
    return reply.code(400).send({ ok: false, code: "bad_request", error: "Geçersiz istek." });
  }

  const m = parsed.data;

  /* Gönderen alan adı denetimi: istekten gelen adres yalnızca
     yapılandırılmış gönderenle AYNI alan adındaysa kabul edilir. */
  const configuredDomain = config.SMTP_FROM_EMAIL.split("@")[1]?.toLowerCase() ?? "";
  const requestedDomain = m.fromEmail?.split("@")[1]?.toLowerCase() ?? "";
  const fromEmail = requestedDomain && requestedDomain === configuredDomain
    ? m.fromEmail!
    : config.SMTP_FROM_EMAIL;
  const fromName = m.fromName?.trim() || config.SMTP_FROM_NAME;

  const res = await sendRawMail({
    to: m.to,
    toName: m.toName,
    subject: m.subject,
    html: m.html,
    text: m.text ?? "",
    fromEmail,
    fromName,
    replyTo: m.replyTo,
  });

  if (!res.ok) {
    req.log.error({ code: res.code }, "ham e-posta gönderilemedi");
    return reply.code(502).send({ ok: false, code: "send_failed", error: res.message });
  }

  return { ok: true, messageId: res.messageId };
});

/* ─────────────── Bakım ─────────────── */

app.post("/v1/maintenance/cleanup", async () => {
  const { rows } = await query<{ cleanup: number }>("select notify.cleanup() as cleanup");
  return { ok: true, cleaned: rows[0]?.cleanup ?? 0 };
});

/* ─────────────── Hata yakalayıcı ─────────────── */

app.setErrorHandler((err, req, reply) => {
  req.log.error({ err }, "işlenmemiş hata");
  // İç hata detayı istemciye SIZDIRILMAZ
  reply.code(500).send({ ok: false, code: "internal_error", error: "Beklenmedik bir hata oluştu." });
});

app.setNotFoundHandler((_req, reply) => {
  reply.code(404).send({ ok: false, code: "not_found", error: "Bulunamadı." });
});

/* ─────────────── Başlat ─────────────── */

async function migrate() {
  const sql = readFileSync(join(__dirname, "lib", "schema.sql"), "utf8");
  await pool.query(sql);
  app.log.info("veritabanı şeması hazır");
}

/**
 * Günlük kart görevini elle çalıştırır.
 *
 * Yönetim panelinden veya bir dış zamanlayıcıdan tetiklenebilir. Yukarıdaki
 * genel preValidation kancası bu yolu da kapsar: imzasız istek 401 alır ve
 * aynı nonce ikinci kez kullanılamaz.
 *
 * Görev zaten çalışıyorsa 409 döner; iki kez tetiklemek kimseye çift
 * e-posta göndermez (veritabanı tekrarı engeller).
 */
app.post("/v1/jobs/daily-cards", async (req, reply) => {
  const result = await runDailyCardJobs((m) => app.log.info(`[zamanlayıcı] ${m}`));
  return reply.code(result.ok ? 200 : 409).send(result);
});

async function start() {
  try {
    await migrate();
    await refreshBranding(true);
    await app.listen({ port: config.PORT, host: config.HOST });

    // Günlük kart görevleri (süre uyarısı + dolum bildirimi)
    startScheduler((m) => app.log.info(`[zamanlayıcı] ${m}`));

    app.log.info(
      `ct-notify çalışıyor · twilio=${config.TWILIO_ENABLED ? config.TWILIO_MODE : "kapalı"}`
      + ` · smtp=${config.SMTP_HOST}`
      + ` · zamanlayıcı=${config.SCHEDULER_ENABLED ? `${config.SCHEDULER_HOUR}:00` : "kapalı"}`,
    );
  } catch (err) {
    app.log.fatal({ err }, "servis başlatılamadı");
    process.exit(1);
  }
}

// Düzgün kapanış: açık istekler tamamlansın
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} alındı, kapatılıyor`);
    stopScheduler();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

// Saatlik temizlik
setInterval(() => {
  query("select notify.cleanup()").catch((err) => app.log.warn({ err }, "temizlik başarısız"));
}, 60 * 60 * 1000).unref();

await start();

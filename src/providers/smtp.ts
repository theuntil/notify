import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";

let transporter: Transporter | null = null;

export function getTransport(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,     // 465 → true, 587 → false (STARTTLS)
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    pool: true,
    maxConnections: 3,
    maxMessages: 50,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  });

  return transporter;
}

export async function verifyTransport(): Promise<{ ok: boolean; error?: string }> {
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}) {
  try {
    const info = await getTransport().sendMail({
      from: `"${config.SMTP_FROM_NAME}" <${config.SMTP_FROM_EMAIL}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      headers: {
        // Otomatik yanıt ve tatil mesajlarını engelle
        "Auto-Submitted": "auto-generated",
        "X-Auto-Response-Suppress": "All",
        ...opts.headers,
      },
    });
    return { ok: true as const, messageId: info.messageId };
  } catch (err) {
    return { ok: false as const, code: "smtp_error", message: (err as Error).message };
  }
}

/**
 * HAM MAİL GÖNDERİMİ
 *
 * Yönetim panelinin mail modülü için: gövde hazır gelir, burada
 * şablon uygulanmaz.
 *
 * ★ `sendMail`den farkı: gönderen adı/adresi ve yanıt adresi çağrandan
 *   gelebiliyor, ayrıca otomatik yanıt engelleme başlıkları KONMUYOR.
 *   Bu mailler gerçek yazışmalar; alıcının yanıt vermesi beklenir.
 */
export async function sendRawMail(opts: {
  to: string;
  toName?: string;
  subject: string;
  html: string;
  text: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
}) {
  try {
    const info = await getTransport().sendMail({
      from: `"${opts.fromName}" <${opts.fromEmail}>`,
      to: opts.toName ? `"${opts.toName}" <${opts.to}>` : opts.to,
      replyTo: opts.replyTo,
      subject: opts.subject,
      html: opts.html,
      text: opts.text || undefined,
    });
    return { ok: true as const, messageId: info.messageId };
  } catch (err) {
    return { ok: false as const, code: "smtp_error", message: (err as Error).message };
  }
}

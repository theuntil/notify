import { query } from "./db.js";
import { config } from "../config.js";
import { templates } from "../templates/index.js";
import { sendMail } from "../providers/smtp.js";

/**
 * Günlük kart görevleri.
 *
 * İki iş yapar:
 *   1. Süresi dolmak üzere olan kartlar için uyarı gönderir
 *   2. Süresi yeni dolmuş kartlar için bilgilendirme gönderir
 *
 * Tekrar gönderimi veritabanı engeller: her kart bildirildiğinde
 * `mark_card_notified` çağrılır ve aynı kart bir daha listelenmez.
 * Bu yüzden görev iki kez çalışsa bile kimse iki e-posta almaz.
 */

interface ExpiringCard {
  card_id: string;
  card_number: string;
  child_name: string;
  email: string;
  valid_until: string;
  days_left: number;
}

interface ExpiredCard {
  card_id: string;
  card_number: string;
  child_name: string;
  email: string;
  valid_until: string;
}

let running = false;
let timer: NodeJS.Timeout | null = null;

/** Bir sonraki çalışma zamanına kadar kaç milisaniye var */
function msUntilNextRun(): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(config.SCHEDULER_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

async function sendExpiryWarnings(log: (m: string) => void): Promise<number> {
  const { rows } = await query<ExpiringCard>(
    "select * from public.cards_needing_expiry_warning($1)",
    [config.EXPIRY_WARNING_DAYS],
  );

  let sent = 0;

  for (const card of rows) {
    if (!card.email) continue;

    try {
      const rendered = templates.card_expiring({
        childName: card.child_name,
        cardNumber: card.card_number,
        validUntil: new Date(card.valid_until).toLocaleDateString("tr-TR"),
        daysLeft: card.days_left,
      });

      await sendMail({
        to: card.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      // Yalnızca gönderim BAŞARILI olduğunda işaretlenir;
      // hata durumunda kart listede kalır ve ertesi gün tekrar denenir.
      await query("select public.mark_card_notified($1, 'warning')", [card.card_id]);
      sent++;
    } catch (err) {
      log(`uyarı gönderilemedi (${card.card_number}): ${(err as Error).message}`);
    }
  }

  return sent;
}

async function sendExpiredNotices(log: (m: string) => void): Promise<number> {
  const { rows } = await query<ExpiredCard>("select * from public.cards_newly_expired()");

  let sent = 0;

  for (const card of rows) {
    if (!card.email) continue;

    try {
      const rendered = templates.card_expired({
        childName: card.child_name,
        cardNumber: card.card_number,
        validUntil: new Date(card.valid_until).toLocaleDateString("tr-TR"),
      });

      await sendMail({
        to: card.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      await query("select public.mark_card_notified($1, 'expired')", [card.card_id]);
      sent++;
    } catch (err) {
      log(`dolum bildirimi gönderilemedi (${card.card_number}): ${(err as Error).message}`);
    }
  }

  return sent;
}

/**
 * Görevleri bir kez çalıştırır.
 * Dışarıdan da çağrılabilir (yönetim panelindeki "şimdi çalıştır" düğmesi).
 */
export async function runDailyCardJobs(
  log: (m: string) => void = console.log,
): Promise<{ ok: boolean; warnings: number; expired: number; error?: string }> {
  // Aynı anda iki çalıştırma olmasın: yavaş bir SMTP sunucusunda
  // görev bir sonraki tetiklemeye taşabilir.
  if (running) {
    return { ok: false, warnings: 0, expired: 0, error: "Görev zaten çalışıyor" };
  }

  running = true;
  const started = Date.now();

  try {
    // Önce süresi geçenleri işaretle, sonra bildirimleri gönder.
    // Sıra önemli: aksi hâlde bugün dolan kart "yeni dolmuş" listesine girmez.
    await query("select public.expire_due_cards()");

    const warnings = await sendExpiryWarnings(log);
    const expired = await sendExpiredNotices(log);

    log(`günlük kart görevi bitti: ${warnings} uyarı, ${expired} dolum bildirimi `
      + `(${Date.now() - started} ms)`);

    return { ok: true, warnings, expired };
  } catch (err) {
    const message = (err as Error).message;
    log(`günlük kart görevi başarısız: ${message}`);
    return { ok: false, warnings: 0, expired: 0, error: message };
  } finally {
    running = false;
  }
}

/** Zamanlayıcıyı başlatır. Kapalıysa hiçbir şey yapmaz. */
export function startScheduler(log: (m: string) => void = console.log): void {
  if (!config.SCHEDULER_ENABLED) {
    log("zamanlayıcı kapalı (SCHEDULER_ENABLED=false)");
    return;
  }

  const schedule = () => {
    const delay = msUntilNextRun();
    const at = new Date(Date.now() + delay);

    timer = setTimeout(() => {
      void runDailyCardJobs(log).finally(schedule);
    }, delay);

    // Zamanlayıcı sürecin kapanmasını engellemesin
    timer.unref?.();

    log(`sonraki kart görevi: ${at.toLocaleString("tr-TR")}`);
  };

  schedule();
}

export function stopScheduler(): void {
  if (timer) { clearTimeout(timer); timer = null; }
}

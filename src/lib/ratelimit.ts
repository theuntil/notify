import { query } from "./db.js";
import { config } from "../config.js";

export type RateWindow = "minute" | "hour" | "day";

const WINDOW_SQL: Record<RateWindow, string> = {
  minute: "date_trunc('minute', now())",
  hour: "date_trunc('hour', now())",
  day: "date_trunc('day', now())",
};

/**
 * Sayaç artırıp sınırı aşıp aşmadığını döner.
 * Tek sorguda upsert yapılır — yarış durumunda bile sayım doğru kalır.
 */
export async function hit(
  key: string, limit: number, window: RateWindow,
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const { rows } = await query<{ hit_count: number }>(
    `insert into notify.rate_counters (bucket_key, window_start, hit_count)
     values ($1, ${WINDOW_SQL[window]}, 1)
     on conflict (bucket_key, window_start)
       do update set hit_count = notify.rate_counters.hit_count + 1
     returning hit_count`,
    [key],
  );

  const count = rows[0]?.hit_count ?? 1;
  return { allowed: count <= limit, count, limit };
}

/** OTP gönderimi için katmanlı sınır: hedef bazlı + IP bazlı */
export async function checkSendLimits(targetHash: string, ipHash: string) {
  const checks = [
    { name: "target_hour", ...(await hit(`t:${targetHash}`, config.RATE_PER_TARGET_HOUR, "hour")) },
    { name: "target_day", ...(await hit(`td:${targetHash}`, config.RATE_PER_TARGET_DAY, "day")) },
    { name: "ip_hour", ...(await hit(`ip:${ipHash}`, config.RATE_PER_IP_HOUR, "hour")) },
  ];

  const blocked = checks.find((c) => !c.allowed);
  return blocked
    ? { allowed: false as const, rule: blocked.name }
    : { allowed: true as const };
}

/** Nonce tekrar kullanımını engeller (replay koruması) */
export async function consumeNonce(nonce: string): Promise<boolean> {
  try {
    const { rowCount } = await query(
      `insert into notify.used_nonces (nonce) values ($1) on conflict do nothing`,
      [nonce],
    );
    return (rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function isBlocked(targetHash: string): Promise<boolean> {
  const { rows } = await query(
    `select 1 from notify.blocklist
      where target_hash = $1 and (blocked_until is null or blocked_until > now())`,
    [targetHash],
  );
  return rows.length > 0;
}

import { query } from "./db.js";
import { config } from "../config.js";
import { setBranding } from "../templates/index.js";

/**
 * Site logolarını ayarlardan okuyup e-posta şablonlarına aktarır.
 *
 * Admin panelinden logo değiştirildiğinde e-postalar da değişsin diye
 * belirli aralıklarla yenilenir. Değer bulunamazsa şablon site adını
 * metin olarak gösterir; kırık görsel çıkmaz.
 */

const CACHE_MS = 5 * 60 * 1000;
let lastFetch = 0;

function publicUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = process.env.SUPABASE_PUBLIC_URL ?? "";
  if (!base) return "";
  return `${base}/storage/v1/object/public/site-media/${path}`;
}

export async function refreshBranding(force = false): Promise<void> {
  if (!force && Date.now() - lastFetch < CACHE_MS) return;
  lastFetch = Date.now();

  try {
    const { rows } = await query<{ key: string; value: unknown }>(
      `select key, value from public.app_settings where key in ('brand.logo_light','brand.logo_dark')`,
    );

    const map = new Map(rows.map((r) => [r.key, String(r.value ?? "").replace(/^"|"$/g, "")]));
    const light = publicUrl(map.get("brand.logo_light") ?? "");
    const dark = publicUrl(map.get("brand.logo_dark") ?? "");

    setBranding(light, dark);
  } catch (err) {
    console.warn("[branding] okunamadı:", (err as Error).message);
  }
}

export const siteName = config.SITE_NAME;

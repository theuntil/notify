import { config } from "../config.js";

/**
 * E-posta şablonları — iOS sistem bildirimi estetiği.
 * Sade, bol boşluklu, tek odak noktası. Koyu mod uyumlu.
 *
 * Not: E-posta istemcilerinin çoğu <style> ve @media desteğini sınırlı sunar.
 * Bu yüzden her şey satır içi stil ile yazılır; koyu mod için
 * prefers-color-scheme + Outlook/Apple Mail'in desteklediği meta etiketleri kullanılır.
 */

const C = {
  bg: "#f2f2f7",        // iOS systemGroupedBackground
  card: "#ffffff",
  ink: "#000000",
  ink2: "#3c3c43",
  muted: "#8e8e93",     // iOS secondaryLabel
  line: "#e5e5ea",
  accent: "#e8ff5a",
  accentInk: "#0f1f1a",
  green: "#34c759",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/**
 * Logo kaynakları çalışma anında ayarlanır (setBranding).
 * Böylece admin panelinden logo değiştirildiğinde e-postalar da güncellenir;
 * şablonlara sabit URL gömülmez.
 */
let brandLogoLight = "";
let brandLogoDark = "";

export function setBranding(light: string, dark: string) {
  brandLogoLight = light || "";
  brandLogoDark = dark || light || "";
}

function logoBlock(): string {
  if (!brandLogoLight) {
    // Logo ayarlanmamışsa site adını metin olarak göster
    return `<span class="ct-muted" style="font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;font-size:12px;font-weight:600;letter-spacing:.06em;color:${C.muted};text-transform:uppercase;">
        ${escapeHtml(config.SITE_NAME)}
      </span>`;
  }

  // Koyu mod: iki logo üst üste, CSS ile hangisi görünecekse o
  return `<img src="${escapeHtml(brandLogoLight)}" alt="${escapeHtml(config.SITE_NAME)}"
        width="44" height="44" class="ct-logo-light"
        style="display:block;width:44px;height:44px;object-fit:contain;border:0;" />
      <img src="${escapeHtml(brandLogoDark)}" alt="" width="44" height="44" class="ct-logo-dark"
        style="display:none;width:44px;height:44px;object-fit:contain;border:0;" />`;
}

function layout(preheader: string, body: string, footerNote?: string): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  @media (prefers-color-scheme: dark) {
    .ct-bg    { background:#000000 !important; }
    .ct-card  { background:#1c1c1e !important; border-color:#38383a !important; }
    .ct-ink   { color:#ffffff !important; }
    .ct-ink2  { color:#ebebf5 !important; }
    .ct-muted { color:#8e8e93 !important; }
    .ct-line  { border-color:#38383a !important; }
    .ct-code  { background:#2c2c2e !important; color:#ffffff !important; border-color:#48484a !important; }
    .ct-soft  { background:#2c2c2e !important; }
    .ct-logo-light { display:none !important; }
    .ct-logo-dark  { display:block !important; }
  }
  @media (max-width:520px) {
    .ct-pad { padding:28px 22px !important; }
    .ct-code-text { font-size:32px !important; letter-spacing:.24em !important; }
  }
</style>
</head>
<body class="ct-bg" style="margin:0;padding:0;background:${C.bg};-webkit-font-smoothing:antialiased;">

<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="ct-bg" style="background:${C.bg};">
<tr><td align="center" style="padding:40px 16px;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:440px;">

    <tr><td align="center" style="padding-bottom:22px;">
      ${logoBlock()}
    </td></tr>

    <tr><td class="ct-card" style="background:${C.card};border:1px solid ${C.line};border-radius:20px;overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td class="ct-pad" style="padding:36px 32px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;">
          ${body}
        </td></tr>
      </table>
    </td></tr>

    <tr><td style="padding:22px 12px 0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;">
      ${footerNote
        ? `<p class="ct-muted" style="margin:0 0 8px;font-size:12.5px;line-height:1.55;color:${C.muted};text-align:center;">${escapeHtml(footerNote)}</p>`
        : ""}
      <p class="ct-muted" style="margin:0;font-size:12px;line-height:1.55;color:${C.muted};text-align:center;">
        <a href="mailto:${config.SUPPORT_EMAIL}" style="color:${C.muted};text-decoration:underline;">${config.SUPPORT_EMAIL}</a>
      </p>
    </td></tr>

  </table>

</td></tr>
</table>
</body></html>`;
}

const title = (t: string) =>
  `<h1 class="ct-ink" style="margin:0 0 10px;font-size:23px;line-height:1.25;font-weight:600;letter-spacing:-.02em;color:${C.ink};">${escapeHtml(t)}</h1>`;

const text = (t: string) =>
  `<p class="ct-ink2" style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.ink2};">${t}</p>`;

const small = (t: string) =>
  `<p class="ct-muted" style="margin:0;font-size:13px;line-height:1.55;color:${C.muted};">${t}</p>`;

/** iOS bildirim kartlarındaki gibi büyük, nefes alan kod alanı */
const codeBlock = (code: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr><td class="ct-code" align="center" style="background:#f2f2f7;border:1px solid ${C.line};border-radius:16px;padding:22px 16px;">
    <div class="ct-code-text" style="font-family:ui-monospace,'SF Mono',SFMono-Regular,Menlo,monospace;font-size:36px;font-weight:600;letter-spacing:.28em;color:${C.ink};text-indent:.28em;">
      ${escapeHtml(code)}
    </div>
  </td></tr>
</table>`;

const button = (href: string, label: string) => `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;">
  <tr><td style="background:${C.accent};border-radius:999px;">
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Roboto,sans-serif;font-size:15px;font-weight:600;color:${C.accentInk};text-decoration:none;">
      ${escapeHtml(label)}
    </a>
  </td></tr>
</table>`;

/** Anahtar-değer satırı (sipariş özeti gibi) */
const row = (k: string, v: string) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 2px;">
  <tr>
    <td class="ct-muted" style="padding:9px 0;font-size:13.5px;color:${C.muted};">${escapeHtml(k)}</td>
    <td class="ct-ink" align="right" style="padding:9px 0;font-size:14.5px;font-weight:600;color:${C.ink};">${escapeHtml(v)}</td>
  </tr>
</table>`;

const divider = `<div class="ct-line" style="height:1px;background:${C.line};margin:22px 0;"></div>`;

export interface Rendered { subject: string; html: string; text: string }

export const templates = {
  email_verify(p: { code: string; ttlMinutes: number }): Rendered {
    return {
      subject: `${p.code} — e-posta doğrulama kodunuz`,
      html: layout(`Doğrulama kodunuz: ${p.code}`,
        title("E-postanızı doğrulayın") +
        text("Aşağıdaki kodu siteye girin.") +
        codeBlock(p.code) +
        small(`Kod ${p.ttlMinutes} dakika geçerli. Bu isteği siz yapmadıysanız yok sayın.`),
        "Kodunuzu kimseyle paylaşmayın."),
      text: `E-posta doğrulama kodunuz: ${p.code}\n${p.ttlMinutes} dakika geçerli.`,
    };
  },

  password_reset(p: { code: string; ttlMinutes: number }): Rendered {
    return {
      subject: `${p.code} — şifre sıfırlama kodunuz`,
      html: layout(`Şifre sıfırlama kodunuz: ${p.code}`,
        title("Şifrenizi sıfırlayın") +
        text("Bu kodu siteye girip yeni şifrenizi belirleyebilirsiniz.") +
        codeBlock(p.code) +
        small(`Kod ${p.ttlMinutes} dakika geçerli.`) +
        divider +
        small("<strong>Bu isteği siz yapmadıysanız</strong> şifreniz değişmedi. Endişeleniyorsanız bize yazın."),
        "Kodunuzu kimseyle paylaşmayın."),
      text: `Şifre sıfırlama kodunuz: ${p.code}\n${p.ttlMinutes} dakika geçerli.\nBu isteği siz yapmadıysanız şifreniz değişmedi.`,
    };
  },

  login_code(p: { code: string; ttlMinutes: number }): Rendered {
    return {
      subject: `${p.code} — giriş kodunuz`,
      html: layout(`Giriş kodunuz: ${p.code}`,
        title("Giriş kodunuz") + codeBlock(p.code) +
        small(`Kod ${p.ttlMinutes} dakika geçerli.`),
        "Kodunuzu kimseyle paylaşmayın."),
      text: `Giriş kodunuz: ${p.code} (${p.ttlMinutes} dk)`,
    };
  },

  welcome(p: { firstName?: string }): Rendered {
    return {
      subject: "Çocuk Tribünü'ne hoş geldiniz",
      html: layout("Aramıza hoş geldiniz",
        title(p.firstName ? `Hoş geldiniz, ${escapeHtml(p.firstName)}` : "Hoş geldiniz") +
        text("Çocukların tribünde güvende olduğu bir futbol kültürü için birlikteyiz.") +
        text("Panelinizden çocuğunuzu ekleyebilir, kombine kart başvurusu yapabilir ve şehrinizdeki etkinliklere katılabilirsiniz.") +
        button(`${config.SITE_URL}/panel`, "Panele git")),
      text: `Hoş geldiniz${p.firstName ? ", " + p.firstName : ""}.\nPanel: ${config.SITE_URL}/panel`,
    };
  },

  order_received(p: { orderNumber: string; amount: string; childName?: string }): Rendered {
    return {
      subject: `Siparişiniz alındı · ${p.orderNumber}`,
      html: layout(`${p.orderNumber} numaralı siparişiniz oluşturuldu`,
        title("Siparişiniz alındı") +
        text("Kombine kart siparişiniz oluşturuldu.") +
        divider +
        row("Sipariş no", p.orderNumber) +
        (p.childName ? row("Kart sahibi", p.childName) : "") +
        row("Tutar", p.amount) +
        divider +
        button(`${config.SITE_URL}/panel/siparisler`, "Siparişimi görüntüle")),
      text: `Siparişiniz alındı: ${p.orderNumber} · ${p.amount}`,
    };
  },

  payment_approved(p: { orderNumber: string }): Rendered {
    return {
      subject: "Ödemeniz onaylandı",
      html: layout("Ödemeniz onaylandı, kartınız hazırlanıyor",
        title("Ödemeniz onaylandı") +
        text(`<strong>${escapeHtml(p.orderNumber)}</strong> numaralı siparişinizin ödemesi onaylandı. Kartınız hazırlanmaya başlandı.`) +
        button(`${config.SITE_URL}/panel/kartlarim`, "Kartlarımı görüntüle")),
      text: `Ödemeniz onaylandı (${p.orderNumber}). Kartınız hazırlanıyor.`,
    };
  },


  /**
   * E-posta değişikliği onayı.
   *
   * Bu e-posta YENİ adrese gider. Adres, bağlantıya tıklanana kadar değişmez;
   * böylece yanlış yazılan bir adres hesabı kilitleyemez.
   */
  email_change(p: { confirmUrl: string; newEmail?: string }): Rendered {
    return {
      subject: "E-posta adresinizi onaylayın · Çocuk Tribünü",
      html: layout("E-posta değişikliğini onaylayın",
        title("E-posta adresinizi onaylayın") +
        text("Çocuk Tribünü hesabınızın e-posta adresini bu adres olarak değiştirmek istediniz.") +
        (p.newEmail ? row("Yeni adres", p.newEmail) : "") +
        divider +
        text("Onaylamak için aşağıdaki düğmeye tıklayın. Bağlantı 2 saat geçerlidir.") +
        button(p.confirmUrl, "E-postamı onayla") +
        small("Bu isteği siz yapmadıysanız bu e-postayı yok sayabilirsiniz; adresiniz değişmez.")),
      text: `E-posta adresinizi onaylayın.\nBağlantı (2 saat geçerli): ${p.confirmUrl}`
        + "\n\nBu isteği siz yapmadıysanız yok sayabilirsiniz.",
    };
  },


  invoice_ready(p: {
    orderNumber: string; invoiceNumber: string;
    amount?: string; issuedAt?: string; downloadUrl?: string;
  }): Rendered {
    return {
      subject: `Faturanız hazır · ${p.invoiceNumber}`,
      html: layout("Siparişinizin faturası yüklendi",
        title("Faturanız hazır") +
        text("Siparişinizin faturası hesabınıza yüklendi.") +
        divider +
        row("Fatura no", p.invoiceNumber) +
        row("Sipariş no", p.orderNumber) +
        (p.amount ? row("Tutar", p.amount) : "") +
        (p.issuedAt ? row("Düzenlenme", p.issuedAt) : "") +
        divider +
        /* Faturaya DOĞRUDAN bağlantı verilmez: e-posta iletilirse fatura
           üçüncü kişilerin eline geçerdi. Kullanıcı kendi paneline girer,
           fatura orada kimliği doğrulanmış şekilde açılır. */
        button(`${config.SITE_URL}/panel/siparislerim/${p.orderNumber}#fatura`,
               "Faturamı görüntüle") +
        (p.downloadUrl
          ? small("İndirme bağlantısı 7 gün geçerlidir. Süresi dolarsa panelinizden erişebilirsiniz.")
          : "")),
      text: `Faturanız hazır.\nFatura: ${p.invoiceNumber}\nSipariş: ${p.orderNumber}`
        + (p.amount ? `\nTutar: ${p.amount}` : "")
        + (p.downloadUrl ? `\nİndir: ${p.downloadUrl}` : ""),
    };
  },




  order_cancelled(p: { orderNumber: string; reason: string }): Rendered {
    return {
      subject: `Siparişiniz iptal edildi · ${p.orderNumber}`,
      html: layout("Siparişiniz iptal edildi",
        title("Siparişiniz iptal edildi") +
        divider +
        row("Sipariş no", p.orderNumber) +
        row("Gerekçe", p.reason) +
        divider +
        small("Sorunuz varsa bize yazabilirsiniz.")),
      text: `Siparişiniz iptal edildi: ${p.orderNumber}. Gerekçe: ${p.reason}`,
    };
  },

  card_expiring(p: {
    cardNumber: string; validUntil: string; daysLeft: number; childName?: string;
  }): Rendered {
    return {
      subject: `Üyeliğinizin bitmesine ${p.daysLeft} gün kaldı`,
      html: layout(`Kombine kart üyeliğiniz ${p.validUntil} tarihinde sona eriyor`,
        title("Üyeliğiniz sona ermek üzere") +
        text(p.childName
          ? `<strong>${escapeHtml(p.childName)}</strong> adına düzenlenen kombine kart üyeliğinizin bitmesine <strong>${p.daysLeft} gün</strong> kaldı.`
          : `Kombine kart üyeliğinizin bitmesine <strong>${p.daysLeft} gün</strong> kaldı.`) +
        divider +
        row("Kart numarası", p.cardNumber) +
        row("Bitiş tarihi", p.validUntil) +
        row("Kalan süre", `${p.daysLeft} gün`) +
        divider +
        button(`${config.SITE_URL}/panel/kombine-kart`, "Üyeliğimi yenile") +
        small("Şimdi yenilerseniz kalan süreniz kaybolmaz; yeni dönem mevcut bitiş tarihinizin üzerine eklenir.")),
      text: `Kombine kart üyeliğinizin bitmesine ${p.daysLeft} gün kaldı.\nKart: ${p.cardNumber}\nBitiş: ${p.validUntil}\nYenile: ${config.SITE_URL}/panel/kombine-kart`,
    };
  },

  card_expired(p: { cardNumber: string; validUntil: string; childName?: string }): Rendered {
    return {
      subject: "Kombine kart üyeliğiniz sona erdi",
      html: layout("Üyeliğiniz sona erdi, yenileyebilirsiniz",
        title("Üyeliğiniz sona erdi") +
        text(p.childName
          ? `<strong>${escapeHtml(p.childName)}</strong> adına düzenlenen kombine kart üyeliğinizin süresi doldu.`
          : "Kombine kart üyeliğinizin süresi doldu.") +
        text("Kartınız artık etkinliklerde kullanılamıyor. Yenileyerek kaldığınız yerden devam edebilirsiniz.") +
        divider +
        row("Kart numarası", p.cardNumber) +
        row("Bitiş tarihi", p.validUntil) +
        divider +
        button(`${config.SITE_URL}/panel/kombine-kart`, "Üyeliğimi yenile")),
      text: `Kombine kart üyeliğiniz sona erdi.\nKart: ${p.cardNumber}\nBitiş: ${p.validUntil}\nYenile: ${config.SITE_URL}/panel/kombine-kart`,
    };
  },

  card_renewed(p: { cardNumber: string; newUntil: string; childName?: string }): Rendered {
    return {
      subject: "Üyeliğiniz yenilendi",
      html: layout(`Üyeliğiniz ${p.newUntil} tarihine kadar uzatıldı`,
        title("Üyeliğiniz yenilendi") +
        text(p.childName
          ? `<strong>${escapeHtml(p.childName)}</strong> adına kombine kart üyeliğiniz uzatıldı.`
          : "Kombine kart üyeliğiniz uzatıldı.") +
        divider +
        row("Kart numarası", p.cardNumber) +
        row("Yeni bitiş tarihi", p.newUntil) +
        divider +
        button(`${config.SITE_URL}/panel/kombine-kart`, "Kartımı görüntüle")),
      text: `Üyeliğiniz yenilendi. Yeni bitiş: ${p.newUntil}`,
    };
  },

  card_ready(p: { cardNumber: string; childName?: string; validUntil: string }): Rendered {
    return {
      subject: "Kombine kartınız hazır",
      html: layout("Dijital kombine kartınız kullanıma hazır",
        title("Kartınız hazır") +
        text(p.childName
          ? `<strong>${escapeHtml(p.childName)}</strong> artık Çocuk Tribünü üyesi.`
          : "Kombine kartınız oluşturuldu.") +
        text("Kartınız dijitaldir. Etkinlik girişlerinde panelinizdeki QR kodu okutmanız yeterli.") +
        divider +
        row("Kart numarası", p.cardNumber) +
        row("Geçerlilik", p.validUntil) +
        divider +
        button(`${config.SITE_URL}/panel/kombine-kart`, "Kartımı görüntüle")),
      text: `Kombine kartınız hazır.\nKart: ${p.cardNumber}\nGeçerlilik: ${p.validUntil}`,
    };
  },

  event_reminder(p: { eventTitle: string; when: string; venue?: string; code?: string }): Rendered {
    return {
      subject: `Yarın: ${p.eventTitle}`,
      html: layout(`${p.eventTitle} — ${p.when}`,
        title(p.eventTitle) +
        divider +
        row("Tarih", p.when) +
        (p.venue ? row("Yer", p.venue) : "") +
        divider +
        (p.code ? text("Girişte gösterin:") + codeBlock(p.code) : "") +
        button(`${config.SITE_URL}/panel/etkinliklerim`, "Kaydımı görüntüle")),
      text: `${p.eventTitle} — ${p.when}${p.venue ? " · " + p.venue : ""}${p.code ? "\nGiriş kodu: " + p.code : ""}`,
    };
  },
} as const;

export type TemplateName = keyof typeof templates;

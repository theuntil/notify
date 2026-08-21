# ct-notify — Doğrulama Servisi

Çocuk Tribünü için e-posta ve SMS doğrulama servisi. Siteden bağımsız çalışır,
kendi Docker konteynerinde durur.

## Ne yapar?

| Uç | İş |
|---|---|
| `POST /v1/otp/send` | SMS veya e-posta ile doğrulama kodu gönderir |
| `POST /v1/otp/verify` | Kodu doğrular |
| `POST /v1/email/send` | Şablonlu işlemsel e-posta gönderir |
| `POST /v1/maintenance/cleanup` | Süresi geçmiş kayıtları temizler |
| `GET /health` | Ayakta mı? |
| `GET /health/deep` | Veritabanı + SMTP + Twilio durumu |

## Güvenlik

Bu servis sadece "kod gönder" kutusu değil; saldırı yüzeyinin tamamı düşünülerek yazıldı.

**İstek imzalama (HMAC-SHA256).** Her istek zaman damgası, tek kullanımlık nonce ve
gövde özetiyle imzalanır. İmzasız istek 401 alır. Servis internete açık olsa bile
yalnızca sırrı bilen taraf kullanabilir.

**Tekrar (replay) koruması.** Kullanılan her nonce veritabanına yazılır. Ağdan yakalanan
bir istek ikinci kez oynatılamaz.

**Zaman penceresi.** 5 dakikadan eski imzalar reddedilir.

**Kodlar düz metin saklanmaz.** OTP, gizli bir pepper ve kayda özel salt ile
HMAC-SHA256 özetlenerek tutulur. Veritabanı sızsa bile kodlar kullanılamaz.
Twilio Verify modunda kod hiç bize gelmez.

**Kişisel veri hash'lenir.** Telefon, e-posta, IP ve user-agent ham hâlde tutulmaz.
Kullanıcıya gösterilmek üzere yalnızca maskeli hâl (`+90 532 *** ** 45`) saklanır.

**Zamanlama saldırısına kapalı karşılaştırma.** Kod kontrolünde `timingSafeEqual`
kullanılır; uzunluk farkı bile sabit maliyetle işlenir.

**Katmanlı hız sınırı.** Hedef başına saatlik ve günlük, IP başına saatlik, ayrıca
Fastify seviyesinde genel sınır. Aynı hedefe arka arkaya kod istenmesi için soğuma süresi.

**Deneme sınırı.** Kod başına en fazla 5 yanlış deneme; sonrasında kayıt kilitlenir.

**Tek aktif kod.** Yeni kod istendiğinde eskisi iptal edilir.

**Bilgi sızdırmayan hatalar.** "Kayıt yok", "hedef eşleşmiyor" ve "süresi dolmuş"
durumları aynı yanıtı döner. Şifre sıfırlamada hesabın var olup olmadığı belli edilmez.

**Konteyner sıkılaştırması.** Root olmayan kullanıcı, salt-okunur dosya sistemi,
tüm capability'ler düşürülmüş, `no-new-privileges`, bellek sınırı, tini ile düzgün
sinyal yönetimi.

**Log hijyeni.** Kod, hedef ve imza başlıkları log'a `[gizlendi]` olarak yazılır.

## Kurulum (Dokploy)

1. Dokploy'da **Compose** tipinde yeni uygulama oluşturun
2. Bu klasörü Git deposu olarak bağlayın (veya `docker-compose.yml` içeriğini yapıştırın)
3. **Environment** sekmesine `.env.example` içindeki değişkenleri girin
4. Deploy

### Zorunlu sırları üretin

```bash
openssl rand -hex 32   # SERVICE_SECRET için
openssl rand -hex 32   # OTP_PEPPER için
```

`SERVICE_SECRET`, Next.js tarafındaki `NOTIFY_SERVICE_SECRET` ile **birebir aynı** olmalı.

`OTP_PEPPER` bir kez belirlenir ve **değiştirilmez** — değiştirirseniz bekleyen tüm
kodlar ve kayıtlı telefon hash'leri geçersiz olur.

### Ağ tercihi

Servisi internete **açmak zorunda değilsiniz**. Next.js ile aynı Docker ağındaysa
domain tanımlamayın, iç adresi kullanın:

```env
NOTIFY_SERVICE_URL=http://ct-notify-notify-1:8080
```

Bu, saldırı yüzeyini tamamen kapatır. Domain vermek isterseniz imza koruması
zaten devrede.

## Twilio

Hesabınızda **Verify Service SID** var (`VA...`), bu yüzden varsayılan mod `verify`.
Bu modda numara satın almanıza gerek yok — Twilio kodu kendi üretir ve doğrular.

`TWILIO_AUTH_TOKEN` değerini Twilio Console → Account details bölümünden alın.
**Bu token'ı kimseyle paylaşmayın**; hesabınızın tam kontrolünü verir.

Numara satın alırsanız `TWILIO_MODE=messaging` yapıp `TWILIO_FROM_NUMBER` girerek
kodu kendimiz üretip yalnızca SMS iletimi için Twilio'yu kullanabilirsiniz.

> Bakiyeniz 13,72 USD. Türkiye'ye SMS yaklaşık 0,05–0,09 USD; kabaca 150–270 doğrulama
> mesajı eder. Trafik arttıkça bakiyeyi takip edin.

## Veritabanı

Servis kendi `notify` şemasını kullanır ve açılışta otomatik oluşturur.
Supabase veritabanınızdaki tablolara **dokunmaz**.

Tablolar: `otp_requests`, `used_nonces`, `rate_counters`, `delivery_log`, `blocklist`.

Saatte bir otomatik temizlik çalışır: süresi geçmiş kodlar işaretlenir, 30 günden
eski OTP kayıtları ve 90 günden eski gönderim log'ları silinir.

## Test edilmiş davranışlar

```
✓ bozuk imza reddedildi              ✓ yanlış kod reddedildi (kalan deneme sayılıyor)
✓ eski zaman damgası reddedildi      ✓ doğru kod kabul edildi
✓ nonce tekrarı engellendi           ✓ kod tekrar kullanılamadı
✓ geçersiz telefon reddedildi        ✓ hedef eşleşmezse reddedildi
✓ sağlayıcı hatası düzgün döndü      ✓ deneme sınırı uygulandı
✓ bilinmeyen şablon reddedildi       ✓ süresi dolmuş kod reddedildi
✓ bilinmeyen uç 404                  ✓ kod düz metin saklanmıyor
✓ temizlik çalıştı                   ✓ hedef hash'lenmiş
✓ olmayan kayıt için sızdırmayan yanıt   ✓ hız sınırı devrede
```

## Yerel geliştirme

```bash
npm install
cp .env.example .env
npm run dev
```

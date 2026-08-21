-- Doğrulama servisi şeması. Servis açılışta bunu kendisi çalıştırır (idempotent).

create schema if not exists notify;

-- ── OTP istekleri ──────────────────────────────────────────────
create table if not exists notify.otp_requests (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null check (channel in ('sms','email')),
  purpose        text not null check (purpose in (
                   'phone_verify','email_verify','password_reset','login','sensitive_action')),
  target_hash    text not null,               -- ham telefon/e-posta SAKLANMAZ
  target_masked  text not null,               -- kullanıcıya gösterilecek maskeli hali
  code_hash      text,                        -- Twilio Verify modunda NULL (kod Twilio'da)
  code_salt      text,
  provider       text not null default 'internal',
  provider_ref   text,                        -- Twilio Verify SID gibi dış referans
  attempts       smallint not null default 0,
  max_attempts   smallint not null,
  status         text not null default 'pending'
                 check (status in ('pending','verified','expired','failed','cancelled')),
  ip_hash        text,
  user_agent_hash text,
  meta           jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  verified_at    timestamptz,
  constraint otp_expiry_future check (expires_at > created_at)
);

create index if not exists otp_target_status_idx
  on notify.otp_requests (target_hash, status, created_at desc);
create index if not exists otp_pending_idx
  on notify.otp_requests (expires_at) where status = 'pending';
create index if not exists otp_created_idx on notify.otp_requests (created_at desc);

-- ── İmza tekrar saldırısı koruması ─────────────────────────────
-- Aynı nonce ikinci kez kullanılamaz: yakalanan bir istek tekrar oynatılamaz.
create table if not exists notify.used_nonces (
  nonce      text primary key,
  used_at    timestamptz not null default now()
);
create index if not exists nonce_cleanup_idx on notify.used_nonces (used_at);

-- ── Hız sınırı sayaçları ───────────────────────────────────────
create table if not exists notify.rate_counters (
  bucket_key   text not null,
  window_start timestamptz not null,
  hit_count    integer not null default 1,
  primary key (bucket_key, window_start)
);
create index if not exists rate_cleanup_idx on notify.rate_counters (window_start);

-- ── Gönderim kaydı (teşhis ve kötüye kullanım tespiti) ─────────
create table if not exists notify.delivery_log (
  id           bigserial primary key,
  channel      text not null,
  template     text,
  target_hash  text not null,
  status       text not null check (status in ('sent','failed','rejected')),
  provider     text,
  error_code   text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);
create index if not exists delivery_created_idx on notify.delivery_log (created_at desc);
create index if not exists delivery_failed_idx on notify.delivery_log (created_at desc)
  where status <> 'sent';

-- ── Engelleme listesi ──────────────────────────────────────────
create table if not exists notify.blocklist (
  target_hash text primary key,
  reason      text not null,
  blocked_at  timestamptz not null default now(),
  blocked_until timestamptz
);

-- ── Temizlik ───────────────────────────────────────────────────
create or replace function notify.cleanup()
returns integer
language plpgsql
as $$
declare v_total int := 0; v_n int;
begin
  update notify.otp_requests set status = 'expired'
   where status = 'pending' and expires_at < now();
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from notify.otp_requests where created_at < now() - interval '30 days';
  get diagnostics v_n = row_count; v_total := v_total + v_n;

  delete from notify.used_nonces where used_at < now() - interval '1 hour';
  delete from notify.rate_counters where window_start < now() - interval '2 days';
  delete from notify.delivery_log where created_at < now() - interval '90 days';
  delete from notify.blocklist where blocked_until is not null and blocked_until < now();

  return v_total;
end;
$$;

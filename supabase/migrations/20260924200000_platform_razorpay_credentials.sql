alter table public.platform_settings
  add column if not exists razorpay_key_id text,
  add column if not exists encrypted_razorpay_key_secret text,
  add column if not exists encrypted_razorpay_webhook_secret text,
  add column if not exists razorpay_webhook_id text;

comment on column public.platform_settings.razorpay_key_id is 'Razorpay Key ID saved from Super Admin settings. Env RAZORPAY_KEY_ID remains a fallback.';
comment on column public.platform_settings.encrypted_razorpay_key_secret is 'AES-GCM encrypted Razorpay key secret.';
comment on column public.platform_settings.encrypted_razorpay_webhook_secret is 'AES-GCM encrypted Razorpay webhook HMAC secret.';
comment on column public.platform_settings.razorpay_webhook_id is 'Razorpay webhook id created or synced from Super Admin settings.';

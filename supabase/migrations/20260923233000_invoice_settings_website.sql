alter table public.invoice_settings
  add column if not exists website text;

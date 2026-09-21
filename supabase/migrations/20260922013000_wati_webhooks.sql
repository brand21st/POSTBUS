alter table public.wati_connections
  add column if not exists webhook_id text,
  add column if not exists last_webhook_at timestamptz,
  add column if not exists last_webhook_event text,
  add column if not exists last_webhook_error text;

comment on column public.wati_connections.webhook_id is
  'Wati webhook subscription id created for this workspace.';

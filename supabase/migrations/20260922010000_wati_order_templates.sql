alter table public.wati_connections
  add column if not exists order_confirmation_template_name text,
  add column if not exists processing_template_name text;

comment on column public.wati_connections.order_confirmation_template_name is
  'Approved Wati template sent when a new Shopify order is imported.';
comment on column public.wati_connections.processing_template_name is
  'Approved Wati template sent when an order starts processing.';

alter table public.automation_settings
  add column if not exists auto_wati_order_confirmation boolean not null default true,
  add column if not exists auto_wati_processing boolean not null default true,
  add column if not exists auto_wati_booked boolean not null default true,
  add column if not exists auto_wati_in_transit boolean not null default true,
  add column if not exists auto_wati_delivered boolean not null default true;

comment on column public.automation_settings.auto_wati_order_confirmation is
  'Send the Wati order confirmation template when a Shopify order is imported.';
comment on column public.automation_settings.auto_wati_processing is
  'Send the Wati processing template when an order moves to Processing.';
comment on column public.automation_settings.auto_wati_booked is
  'Send the Wati booked template when India Post returns a tracking id.';
comment on column public.automation_settings.auto_wati_in_transit is
  'Send the Wati in-transit template when the article first moves.';
comment on column public.automation_settings.auto_wati_delivered is
  'Send the Wati delivered template when the shipment is delivered.';

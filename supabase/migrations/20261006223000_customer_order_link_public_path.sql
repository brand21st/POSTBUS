-- Public WhatsApp form URLs: /order/{workspace}/{code}/whatsapp-order-form

alter table public.customer_order_links
  add column if not exists public_workspace text,
  add column if not exists public_code text;

create unique index if not exists customer_order_links_org_public_code_idx
  on public.customer_order_links (organization_id, public_code)
  where public_code is not null;

-- Public WhatsApp form URLs: /order/{4-digit-org-id}/{workspace}/WhatsApp-order-form
-- The 4-digit code is unique across merchants.

create unique index if not exists customer_order_links_public_code_digits_uidx
  on public.customer_order_links (public_code)
  where public_code is not null and public_code ~ '^[0-9]{4}$';

comment on column public.customer_order_links.public_code is
  'Hashed 4-digit organization identifier used in the public order URL.';

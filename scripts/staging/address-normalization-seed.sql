-- Synthetic rows for integrity proof. No real merchant PII.

insert into public.organizations (name)
select 'staging-address-org'
where not exists (select 1 from public.organizations where name = 'staging-address-org');

do $$
declare
  org uuid;
  booked_addr uuid;
  edited_addr uuid;
  legacy_addr uuid;
  booked_ord uuid;
  edited_ord uuid;
begin
  select id into org from public.organizations where name = 'staging-address-org' limit 1;

  insert into public.addresses (organization_id, line1, city, state, pincode, name, phone)
  values (org, 'Booked House', 'Kozhikode', 'Kerala', '673001', 'Booked Person', '9876543210')
  returning id into booked_addr;

  insert into public.addresses (organization_id, line1, city, state, pincode, name)
  values (org, 'Merchant Corrected', 'Kalpetta', 'Kerala', '673121', 'Edited')
  returning id into edited_addr;

  insert into public.addresses (organization_id, line1, city, state, pincode)
  values (org, 'Unknown provenance', 'Mysuru', 'Karnataka', '570001')
  returning id into legacy_addr;

  insert into public.orders (organization_id, shipping_address_id, order_number)
  values (org, booked_addr, '#B1') returning id into booked_ord;

  insert into public.orders (organization_id, shipping_address_id, order_number)
  values (org, edited_addr, '#E1') returning id into edited_ord;

  insert into public.audit_logs (organization_id, action, entity_type, entity_id)
  values (org, 'order.shipping_address_updated', 'order', edited_ord);

  insert into public.shipments (organization_id, order_id, status, booked_at, barcode, tracking_number)
  values (org, booked_ord, 'BOOKED', now(), 'ET214330016IN', 'ET214330016IN');
end $$;

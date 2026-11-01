begin;
create temp table legacy_addr_probe as
select id, address_manual_override, address_validation_status
from public.addresses
limit 0;

-- Representative legacy shape: NULL override, NULL validation, real street fields.
insert into public.addresses (
  organization_id, kind, name, phone, line1, city, state, pincode, country,
  address_manual_override, address_validation_status
)
select
  o.id,
  'shipping',
  'Legacy Probe',
  '9876543210',
  'Ward 4 ആശ',
  'Kozhikode',
  'Kerala',
  '673001',
  'IN',
  null,
  null
from public.organizations o
limit 1
returning id;

select
  address_manual_override is null as override_null,
  address_validation_status is null as status_null,
  line1 = 'Ward 4 ആശ' as malayalam_kept
from public.addresses
where name = 'Legacy Probe'
order by created_at desc
limit 1;

rollback;

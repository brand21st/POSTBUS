-- Original and normalized Shopify shipping details live on the address row.
--
-- Provenance of address_manual_override:
--   NULL  = legacy / unknown (protect from automatic Shopify overwrite)
--   true  = merchant confirmed override
--   false = Shopify-managed (new imports after this migration)
--
-- Existing booked shipments are not reclassified. Status stays null until
-- an explicit revalidate or a permitted Shopify refresh.

alter table public.addresses
  add column if not exists line3 text,
  add column if not exists original_phone text,
  add column if not exists phone_source text,
  add column if not exists original_shipping jsonb,
  add column if not exists normalized_shipping jsonb,
  add column if not exists address_validation_status text,
  add column if not exists address_normalization_source text,
  add column if not exists address_normalized_at timestamptz,
  add column if not exists address_review_required boolean not null default false,
  add column if not exists address_validation_errors jsonb not null default '[]'::jsonb,
  add column if not exists address_manual_override boolean;

-- New inserts default to Shopify-managed. Existing rows stay NULL unless
-- a merchant edit is found in audit logs.
alter table public.addresses
  alter column address_manual_override drop not null;

alter table public.addresses
  alter column address_manual_override set default false;

-- Recover from an earlier unshipped draft that applied NOT NULL DEFAULT false.
update public.addresses
set address_manual_override = null
where address_manual_override is false
  and original_shipping is null;

update public.addresses as addr
set address_manual_override = true
from public.orders as ord
join public.audit_logs as log
  on log.entity_id = ord.id
 and log.organization_id = ord.organization_id
 and log.action = 'order.shipping_address_updated'
where addr.id = ord.shipping_address_id
  and addr.address_manual_override is distinct from true;

alter table public.addresses
  drop constraint if exists addresses_validation_status_chk;

alter table public.addresses
  add constraint addresses_validation_status_chk
  check (
    address_validation_status is null
    or address_validation_status in ('READY', 'NEEDS_REVIEW', 'INVALID')
  );

create index if not exists addresses_validation_status_org_idx
  on public.addresses (organization_id, address_validation_status)
  where address_validation_status is not null;

create index if not exists addresses_manual_override_org_idx
  on public.addresses (organization_id)
  where address_manual_override is true;

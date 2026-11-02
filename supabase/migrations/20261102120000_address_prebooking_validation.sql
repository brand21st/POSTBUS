-- Pre-booking checks need a retryable status and a fingerprint of the
-- fields that were actually checked. A matching fingerprint is the only
-- cache key; changing the address clears it.

alter table public.addresses
  add column if not exists address_validation_fingerprint text;

alter table public.addresses
  drop constraint if exists addresses_validation_status_chk;

alter table public.addresses
  add constraint addresses_validation_status_chk
  check (
    address_validation_status is null
    or address_validation_status in ('READY', 'NEEDS_REVIEW', 'INVALID', 'VALIDATION_UNAVAILABLE')
  );

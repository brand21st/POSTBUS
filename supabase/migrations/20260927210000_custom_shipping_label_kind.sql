-- Custom shipping labels are stored beside the official India Post PDF and the packing slip.

alter table public.labels
  drop constraint if exists labels_kind_chk;

alter table public.labels
  add constraint labels_kind_chk
  check (kind in ('INDIA_POST', 'MERCHANT', 'CUSTOM_SHIPPING'));

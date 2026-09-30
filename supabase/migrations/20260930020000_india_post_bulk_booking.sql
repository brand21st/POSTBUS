-- Atomic barcode serial allocation for concurrent booking workers.
create or replace function public.allocate_barcode_serial(p_range_id uuid)
returns table (prefix text, serial bigint, suffix text)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_next bigint;
  current_end bigint;
  current_prefix text;
  current_suffix text;
begin
  select barcode_ranges.prefix, barcode_ranges.suffix, barcode_ranges.next_number, barcode_ranges.end_number
    into current_prefix, current_suffix, current_next, current_end
  from public.barcode_ranges
  where id = p_range_id
  for update;

  if current_prefix is null then
    raise exception 'Barcode range not found';
  end if;
  if current_next > current_end then
    raise exception 'Barcode range exhausted';
  end if;

  update public.barcode_ranges
    set next_number = current_next + 1, updated_at = now()
    where id = p_range_id;

  prefix := current_prefix;
  serial := current_next;
  suffix := current_suffix;
  return next;
end;
$$;

revoke all on function public.allocate_barcode_serial(uuid) from public;
grant execute on function public.allocate_barcode_serial(uuid) to service_role;

alter table public.shipments
  add column if not exists correlation_id text;

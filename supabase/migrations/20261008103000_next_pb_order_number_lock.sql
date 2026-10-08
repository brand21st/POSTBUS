-- Serialize PB-##### allocation per org. The previous STABLE max()+1 RPC
-- released before INSERT, so two Saves could both receive the same number.

create or replace function public.next_pb_order_number(p_organization_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  next_n int;
begin
  perform pg_advisory_xact_lock(87251403, hashtext(p_organization_id::text));
  select coalesce(max((regexp_replace(order_number, '^PB-', '', 'i'))::int), 10000) + 1
    into next_n
    from public.orders
    where organization_id = p_organization_id
      and order_number ~* '^PB-[0-9]+$';
  return 'PB-' || next_n;
end;
$$;

revoke all on function public.next_pb_order_number(uuid) from public, anon;
grant execute on function public.next_pb_order_number(uuid) to authenticated, service_role;

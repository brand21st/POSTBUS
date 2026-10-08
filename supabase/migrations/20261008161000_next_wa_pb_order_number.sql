-- Serialize WA-PB-##### allocation per org for WhatsApp/storefront orders.

create or replace function public.next_wa_pb_order_number(p_organization_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  next_n int;
begin
  perform pg_advisory_xact_lock(87251404, hashtext(p_organization_id::text));
  select coalesce(max((regexp_replace(order_number, '^#?WA-PB-', '', 'i'))::int), 10000) + 1
    into next_n
    from public.orders
    where organization_id = p_organization_id
      and order_number ~* '^#?WA-PB-[0-9]+$';
  return 'WA-PB-' || next_n;
end;
$$;

revoke all on function public.next_wa_pb_order_number(uuid) from public, anon;
grant execute on function public.next_wa_pb_order_number(uuid) to authenticated, service_role;

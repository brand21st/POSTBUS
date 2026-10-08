-- Allocate the next PB-##### from a SQL max(), not a PostgREST page of order rows.
-- Large orgs exceed the 1000-row API cap, which reused existing numbers.

create or replace function public.next_pb_order_number(p_organization_id uuid)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select 'PB-' || (
    coalesce(
      max((regexp_replace(order_number, '^PB-', '', 'i'))::int),
      10000
    ) + 1
  )
  from public.orders
  where organization_id = p_organization_id
    and order_number ~* '^PB-[0-9]+$';
$$;

revoke all on function public.next_pb_order_number(uuid) from public, anon;
grant execute on function public.next_pb_order_number(uuid) to authenticated, service_role;

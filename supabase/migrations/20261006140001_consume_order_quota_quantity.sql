-- Optional quantity for consume_order_quota. Default 1 keeps existing RPC callers.

drop function if exists public.consume_order_quota(uuid);

create or replace function public.consume_order_quota(
  p_org uuid,
  p_quantity integer default 1
)
returns table(orders_used integer, order_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage public.billing_usage;
  v_used integer;
  v_limit integer;
  v_qty integer := greatest(0, coalesce(p_quantity, 1));
begin
  if v_qty = 0 then
    v_usage := public.ensure_billing_period(p_org);
    return query select v_usage.orders_used, v_usage.order_limit;
    return;
  end if;

  v_usage := public.ensure_billing_period(p_org);

  update public.billing_usage u
  set orders_used = u.orders_used + v_qty
  where u.id = v_usage.id
    and (u.order_limit is null or u.orders_used + v_qty <= u.order_limit)
  returning u.orders_used, u.order_limit into v_used, v_limit;

  if v_used is null then
    return;
  end if;

  return query select v_used, v_limit;
end;
$$;

revoke all on function public.consume_order_quota(uuid, integer) from public;
revoke all on function public.consume_order_quota(uuid, integer) from anon;
revoke all on function public.consume_order_quota(uuid, integer) from authenticated;
grant execute on function public.consume_order_quota(uuid, integer) to service_role, authenticated;

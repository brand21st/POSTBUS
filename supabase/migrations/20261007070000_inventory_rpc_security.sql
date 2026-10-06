-- Inventory commits are a booking-side operation. Do not expose this
-- SECURITY DEFINER function directly through PostgREST.
revoke all on function public.commit_order_inventory(uuid) from public, anon, authenticated;
grant execute on function public.commit_order_inventory(uuid) to service_role;

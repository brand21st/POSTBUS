-- Booking quota must not be callable with an end-user JWT.
-- consumeQuota only runs from the service-role worker (workers/processor.ts).
-- Do not apply until authorized. Does not change quota arithmetic.

revoke all on function public.consume_order_quota(uuid, integer) from public;
revoke all on function public.consume_order_quota(uuid, integer) from anon;
revoke all on function public.consume_order_quota(uuid, integer) from authenticated;
grant execute on function public.consume_order_quota(uuid, integer) to service_role;

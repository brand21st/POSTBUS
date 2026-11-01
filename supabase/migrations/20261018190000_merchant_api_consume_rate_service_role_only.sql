-- Supabase grants EXECUTE on new functions to anon/authenticated unless revoked by role.
revoke all on function public.merchant_api_consume_rate(text, timestamptz, integer) from public;
revoke all on function public.merchant_api_consume_rate(text, timestamptz, integer) from anon;
revoke all on function public.merchant_api_consume_rate(text, timestamptz, integer) from authenticated;
grant execute on function public.merchant_api_consume_rate(text, timestamptz, integer) to service_role;

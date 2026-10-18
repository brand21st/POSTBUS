-- PostgREST cannot pick between the 4-arg and 5-arg overloads when p_search is omitted.
drop function if exists public.label_shipment_groups(uuid, text, integer, integer);

revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text) from public;
revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text) from anon;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text) to authenticated;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text) to service_role;

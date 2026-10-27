-- PostgREST cannot pick between the 5-arg and 7-arg overloads when p_from/p_to are omitted.
drop function if exists public.label_shipment_groups(uuid, text, integer, integer, text);

revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) from public;
revoke all on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) from anon;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.label_shipment_groups(uuid, text, integer, integer, text, timestamptz, timestamptz) to service_role;

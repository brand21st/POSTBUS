-- Dashboard WhatsApp confirm uses the tenant client, not service_role.
-- The function remains SECURITY DEFINER and still requires matching organization_id + order_id.

grant execute on function public.resolve_whatsapp_payment_claim(text, uuid, uuid, text, numeric, numeric, jsonb)
  to authenticated;

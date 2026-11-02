create or replace view public.admin_abandoned_signups as
select
  u.id,
  u.email,
  u.created_at,
  nullif(u.raw_user_meta_data->>'full_name', '') as full_name,
  nullif(u.raw_user_meta_data->>'whatsapp_number', '') as whatsapp_number,
  nullif(u.raw_user_meta_data->>'pincode', '') as pincode,
  nullif(btrim(u.raw_user_meta_data->>'city'), '') as city
from auth.users u
where u.email_confirmed_at is null
  and u.phone_confirmed_at is null;

revoke all on public.admin_abandoned_signups from public, anon, authenticated;
grant select on public.admin_abandoned_signups to service_role;

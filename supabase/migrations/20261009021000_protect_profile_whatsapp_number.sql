-- Block merchant self-service changes to profiles.whatsapp_number.
-- Other profile columns stay editable through profiles_self.
-- Service role (OTP linking, support) and a no-JWT database session may still change it.
-- Does not unique-index the column and does not rewrite existing numbers.
-- Decision matches profileWhatsappChangeAllowed in lib/auth/identity/whatsapp-guard.ts.

create or replace function public.protect_profile_whatsapp_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  jwt_role text := coalesce(auth.role(), '');
begin
  if new.whatsapp_number is not distinct from old.whatsapp_number then
    return new;
  end if;

  if jwt_role = 'service_role' then
    return new;
  end if;

  if jwt_role = '' and auth.uid() is null then
    return new;
  end if;

  raise exception 'WhatsApp number cannot be changed from this account'
    using errcode = '42501';
end;
$$;

revoke all on function public.protect_profile_whatsapp_number() from public, anon, authenticated;

drop trigger if exists profiles_protect_whatsapp_number on public.profiles;

create trigger profiles_protect_whatsapp_number
  before update of whatsapp_number on public.profiles
  for each row
  execute function public.protect_profile_whatsapp_number();

comment on function public.protect_profile_whatsapp_number() is
  'Rejects authenticated and anon updates that change profiles.whatsapp_number. Login identity is phone_identities.';

alter table public.profiles
  add column if not exists whatsapp_number text;

comment on column public.profiles.whatsapp_number is
  'Indian WhatsApp number in E.164 format (+91 and 10 digits starting 6-9).';

alter table public.profiles
  drop constraint if exists profiles_whatsapp_number_format;

alter table public.profiles
  add constraint profiles_whatsapp_number_format
  check (
    whatsapp_number is null
    or whatsapp_number ~ '^\+91[6-9][0-9]{9}$'
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, whatsapp_number)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data->>'whatsapp_number', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        whatsapp_number = coalesce(public.profiles.whatsapp_number, excluded.whatsapp_number);
  return new;
end;
$$;

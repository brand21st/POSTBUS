alter table public.profiles
  add column if not exists pincode text;

alter table public.profiles
  add column if not exists city text;

comment on column public.profiles.pincode is
  'Indian 6-digit PIN code collected at registration.';

comment on column public.profiles.city is
  'City collected at registration.';

alter table public.profiles
  drop constraint if exists profiles_pincode_format;

alter table public.profiles
  add constraint profiles_pincode_format
  check (
    pincode is null
    or pincode ~ '^[1-9][0-9]{5}$'
  );

alter table public.profiles
  drop constraint if exists profiles_city_length;

alter table public.profiles
  add constraint profiles_city_length
  check (
    city is null
    or char_length(city) between 2 and 80
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, whatsapp_number, pincode, city)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data->>'whatsapp_number', ''),
    nullif(new.raw_user_meta_data->>'pincode', ''),
    nullif(btrim(new.raw_user_meta_data->>'city'), '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        whatsapp_number = coalesce(public.profiles.whatsapp_number, excluded.whatsapp_number),
        pincode = coalesce(public.profiles.pincode, excluded.pincode),
        city = coalesce(public.profiles.city, excluded.city);
  return new;
end;
$$;

alter table public.automation_settings
  alter column auto_ai_address_check set default false;

update public.automation_settings
  set auto_ai_address_check = false
  where auto_ai_address_check is distinct from false;

comment on column public.automation_settings.auto_ai_address_check is
  'When true, AI may correct address lines before India Post booking. Default off for every workspace. PIN lookup still runs.';

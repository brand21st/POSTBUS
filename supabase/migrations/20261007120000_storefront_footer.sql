-- Storefront footer appearance (colors, layout, social URLs, section visibility).
-- Business, contact, and policy copy stay on organizations / organization_policies / invoice_settings.

alter table public.storefront_settings
  add column if not exists footer jsonb not null default '{}'::jsonb;

comment on column public.storefront_settings.footer is
  'Merchant storefront footer presentation: colors, layout, section visibility, and public social URLs.';

-- Dedicated privacy document in Settings (WhatsApp + public storefront). Terms remain separate.

alter table public.organization_policies
  add column if not exists privacy_policy_body text not null default '',
  add column if not exists privacy_policy_keywords text[] not null default '{}',
  add column if not exists privacy_policy_enabled boolean not null default true;

do $$ begin
  alter table public.organization_policies
    add constraint organization_policies_privacy_body_chk check (char_length(privacy_policy_body) <= 8000);
exception when duplicate_object then null;
end $$;

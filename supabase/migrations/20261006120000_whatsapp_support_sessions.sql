-- Platform WhatsApp support sessions (Super Admin VaChat / common PostBus number).
-- One row per customer phone. Not organization-scoped: the same number can span merchants.
-- Service role only. Do not grant to anon/authenticated.

create table if not exists public.whatsapp_support_sessions (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'platform'
    check (source = 'platform'),
  phone_digits text not null
    check (phone_digits ~ '^[6-9][0-9]{9}$'),
  selected_order_id uuid references public.orders(id) on delete set null,
  selected_organization_id uuid references public.organizations(id) on delete set null,
  state text not null default 'IDENTIFY'
    check (state in (
      'IDENTIFY',
      'LIST_ELIGIBLE',
      'AWAIT_SELECTION',
      'ORDER_BOUND',
      'CONFIRM_ACTION',
      'EXPIRED'
    )),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_digits)
);

create index if not exists whatsapp_support_sessions_expires_idx
  on public.whatsapp_support_sessions (expires_at);

comment on table public.whatsapp_support_sessions is
  'Platform WhatsApp AI support context for the common PostBus number. Authorization is phone_digits plus selected order/org; never AI-supplied tenant ids.';

comment on column public.whatsapp_support_sessions.phone_digits is
  'Canonical 10-digit Indian mobile (extractIndiaMobileDigits). Raw WhatsApp is never stored.';

comment on column public.whatsapp_support_sessions.source is
  'Always platform. Super Admin VaChat only; merchant vachat_connections must not use this table.';

drop trigger if exists set_whatsapp_support_sessions_updated_at on public.whatsapp_support_sessions;
create trigger set_whatsapp_support_sessions_updated_at
  before update on public.whatsapp_support_sessions
  for each row execute function public.set_updated_at();

alter table public.whatsapp_support_sessions enable row level security;

revoke all on table public.whatsapp_support_sessions from anon, authenticated;

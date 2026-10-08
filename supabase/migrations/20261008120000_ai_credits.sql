-- Workspace AI credit pool for WhatsApp paste extract. Pack price lives on platform_settings.

alter table public.organizations
  add column if not exists ai_credits_balance integer not null default 500;

alter table public.organizations
  drop constraint if exists organizations_ai_credits_balance_nonnegative;
alter table public.organizations
  add constraint organizations_ai_credits_balance_nonnegative
  check (ai_credits_balance >= 0);

comment on column public.organizations.ai_credits_balance is
  'Workspace pool for OpenRouter WhatsApp extract. New orgs start at 500. One successful AI extract spends 1.';

alter table public.platform_settings
  add column if not exists ai_credit_pack_size integer not null default 500,
  add column if not exists ai_credit_pack_paise bigint not null default 9900;

comment on column public.platform_settings.ai_credit_pack_size is
  'Credits granted per Razorpay AI credit pack purchase.';
comment on column public.platform_settings.ai_credit_pack_paise is
  'Razorpay amount in paise for one AI credit pack (default ₹99).';

alter table public.payments
  add column if not exists ai_credit_pack_size integer;

comment on column public.payments.ai_credit_pack_size is
  'Credits to grant when billing_cycle is ai_credits and this payment becomes CAPTURED.';

create or replace function public.consume_ai_credit(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  update public.organizations
  set ai_credits_balance = ai_credits_balance - 1,
      updated_at = now()
  where id = p_org
    and ai_credits_balance > 0
  returning ai_credits_balance into v_remaining;

  if v_remaining is null then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = p_org;
    return coalesce(v_remaining, 0);
  end if;

  return v_remaining;
end;
$$;

create or replace function public.grant_ai_credits(p_org uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
  v_qty integer := greatest(0, coalesce(p_amount, 0));
begin
  if v_qty = 0 then
    select coalesce(ai_credits_balance, 0) into v_remaining
    from public.organizations
    where id = p_org;
    return coalesce(v_remaining, 0);
  end if;

  update public.organizations
  set ai_credits_balance = ai_credits_balance + v_qty,
      updated_at = now()
  where id = p_org
  returning ai_credits_balance into v_remaining;

  return coalesce(v_remaining, 0);
end;
$$;

revoke all on function public.consume_ai_credit(uuid) from public;
revoke all on function public.consume_ai_credit(uuid) from anon;
grant execute on function public.consume_ai_credit(uuid) to authenticated, service_role;

revoke all on function public.grant_ai_credits(uuid, integer) from public;
revoke all on function public.grant_ai_credits(uuid, integer) from anon;
revoke all on function public.grant_ai_credits(uuid, integer) from authenticated;
grant execute on function public.grant_ai_credits(uuid, integer) to service_role;

-- Additive, default-off affiliate module. Apply only to an authorized environment.
create table public.affiliate_settings (
 id boolean primary key default true check(id), registration_open boolean not null default true,
 attribution_days integer not null default 30 check(attribution_days between 1 and 90),
 hold_days integer not null default 30 check(hold_days between 1 and 365),
 minimum_payout_paise bigint not null default 100000 check(minimum_payout_paise > 0),
 created_at timestamptz not null default now()
);
insert into public.affiliate_settings(id) values(true);
create table public.affiliate_profiles (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete restrict,
 status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED','SUSPENDED')),
 application jsonb not null, terms_version text not null, rejection_reason text,
 created_at timestamptz not null default now()
);
create table public.affiliate_links (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references public.affiliate_profiles(id),
 code text not null unique, campaign text not null default '', enabled boolean not null default true,
 created_at timestamptz not null default now(), unique(affiliate_id,campaign)
);
create table public.affiliate_click_events (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references public.affiliate_profiles(id),
 link_id uuid not null references public.affiliate_links(id), visitor text not null,
 created_at timestamptz not null default now()
);
create index affiliate_click_time on public.affiliate_click_events(affiliate_id,created_at);
create index affiliate_click_visitor on public.affiliate_click_events(link_id,visitor,created_at);
create table public.affiliate_signup_claims (
 user_id uuid primary key references auth.users(id), link_id uuid not null references public.affiliate_links(id),
 expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table public.affiliate_attributions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null unique references public.organizations(id) on delete restrict,
 affiliate_id uuid not null references public.affiliate_profiles(id), link_id uuid not null references public.affiliate_links(id),
 policy_version text not null default 'first-touch-v1', created_at timestamptz not null default now()
);
create index affiliate_attribution_partner on public.affiliate_attributions(affiliate_id,created_at);
create table public.affiliate_attribution_corrections (
 id uuid primary key default gen_random_uuid(), attribution_id uuid not null references public.affiliate_attributions(id),
 affiliate_id uuid not null references public.affiliate_profiles(id),link_id uuid not null references public.affiliate_links(id),
 actor_id uuid not null references auth.users(id),reason text not null,created_at timestamptz not null default now()
);
create table public.affiliate_policies (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid references public.affiliate_profiles(id),
 version bigint generated always as identity,
 link_id uuid references public.affiliate_links(id), basis_points integer not null default 2000 check(basis_points between 0 and 10000),
 fixed_paise bigint check(fixed_paise >= 0), effective_at timestamptz not null default now(),
 created_at timestamptz not null default now(), check(link_id is null or affiliate_id is not null)
);
insert into public.affiliate_policies(basis_points) values(2000);
create table public.affiliate_payment_evidence (
 id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.payments(id) on delete restrict,
 provider_payment_id text not null, amount_paise bigint not null check(amount_paise > 0),
 refunded_paise bigint not null check(refunded_paise >= 0 and refunded_paise <= amount_paise),
 captured_at timestamptz not null, source text not null, created_at timestamptz not null default now(),
 unique(payment_id,refunded_paise)
);
create table public.affiliate_tax_evidence (
 id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.payments(id),
 refunded_paise bigint not null check(refunded_paise>=0), tax_paise bigint not null check(tax_paise>=0),
 refunded_tax_paise bigint not null check(refunded_tax_paise between 0 and tax_paise),
 reason text not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 unique(payment_id,refunded_paise)
);
create table public.affiliate_commissions (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references public.affiliate_profiles(id),
 attribution_id uuid not null references public.affiliate_attributions(id), payment_id uuid not null unique references public.payments(id),
 policy_id uuid not null references public.affiliate_policies(id), policy_snapshot jsonb not null,
 net_paise bigint not null check(net_paise>0), amount_paise bigint not null check(amount_paise>=0),
 available_at timestamptz not null, created_at timestamptz not null default now()
);
create index affiliate_commission_partner on public.affiliate_commissions(affiliate_id,created_at);
create table public.affiliate_payout_accounts (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references public.affiliate_profiles(id),
 encrypted_details text not null, masked_details text not null, created_at timestamptz not null default now()
);
create table public.affiliate_payout_requests (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references public.affiliate_profiles(id),
 account_id uuid not null references public.affiliate_payout_accounts(id), amount_paise bigint not null check(amount_paise>0),
 status text not null default 'REQUESTED' check(status in ('REQUESTED','APPROVED','PAID','REJECTED','REVIEW','RETURNED')),
 idempotency_key uuid not null unique, settlement_reference text unique, settled_at timestamptz,
 created_at timestamptz not null default now()
);
create table public.affiliate_ledger_entries (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references public.affiliate_profiles(id),
 commission_id uuid references public.affiliate_commissions(id), payout_id uuid references public.affiliate_payout_requests(id),
 kind text not null check(kind in ('ACCRUAL','APPROVAL','REVERSAL','ADJUSTMENT','RESERVATION','RELEASE','PAYOUT','PAYOUT_RETURN')),
 amount_paise bigint not null, idempotency_key text not null unique, created_at timestamptz not null default now()
);
create index affiliate_ledger_partner on public.affiliate_ledger_entries(affiliate_id,created_at);
create table public.affiliate_payout_allocations (
 id uuid primary key default gen_random_uuid(), payout_id uuid not null references public.affiliate_payout_requests(id),
 ledger_id uuid not null references public.affiliate_ledger_entries(id), amount_paise bigint not null check(amount_paise>0),
 created_at timestamptz not null default now(), unique(payout_id,ledger_id)
);
create table public.affiliate_audit_logs (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid references public.affiliate_profiles(id),
 actor_id uuid references auth.users(id), action text not null, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.affiliate_notifications (
 id uuid primary key default gen_random_uuid(), affiliate_id uuid not null references public.affiliate_profiles(id),
 message text not null, created_at timestamptz not null default now()
);
create table public.affiliate_processing (
 payment_id uuid primary key references public.payments(id), status text not null default 'PENDING',
 lease uuid,
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), created_at timestamptz not null default now()
);

create function public.affiliate_immutable() returns trigger language plpgsql as $$
begin raise exception 'Affiliate history is immutable'; end $$;
do $$ declare t text; begin
 foreach t in array array['affiliate_attributions','affiliate_policies','affiliate_payment_evidence','affiliate_tax_evidence','affiliate_commissions','affiliate_ledger_entries','affiliate_audit_logs','affiliate_payout_accounts','affiliate_payout_allocations','affiliate_attribution_corrections'] loop
 execute format('create trigger immutable before update or delete on public.%I for each row execute function public.affiliate_immutable()',t);
 end loop;
 foreach t in array array['affiliate_settings','affiliate_profiles','affiliate_links','affiliate_click_events','affiliate_signup_claims','affiliate_attributions','affiliate_policies','affiliate_payment_evidence','affiliate_tax_evidence','affiliate_commissions','affiliate_payout_accounts','affiliate_payout_requests','affiliate_ledger_entries','affiliate_audit_logs','affiliate_notifications','affiliate_processing','affiliate_payout_allocations','affiliate_attribution_corrections'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
 foreach t in array array['affiliate_links','affiliate_attributions','affiliate_commissions','affiliate_payout_requests','affiliate_ledger_entries','affiliate_notifications'] loop
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy own_partner_read on public.%I for select to authenticated using (affiliate_id in (select id from public.affiliate_profiles where user_id=auth.uid()))',t);
 end loop;
end $$;
grant select on public.affiliate_profiles to authenticated;
create policy own_profile on public.affiliate_profiles for select to authenticated using(user_id=auth.uid());

-- Called by the existing organization service instead of changing the existing RPC body.
create function public.affiliate_create_organization(p_name text) returns public.organizations
language plpgsql security definer set search_path=public as $$
declare o public.organizations; c public.affiliate_signup_claims; l public.affiliate_links;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if exists(select 1 from organization_members where user_id=auth.uid()) then
   select org.* into o from organizations org join organization_members m on m.organization_id=org.id where m.user_id=auth.uid() limit 1;
   return o;
 end if;
 select * into c from affiliate_signup_claims where user_id=auth.uid() and expires_at>now();
 select * into o from create_organization_for_user(p_name);
 if c.user_id is not null then
   select * into l from affiliate_links where id=c.link_id and enabled;
   if l.id is not null and exists(select 1 from affiliate_profiles where id=l.affiliate_id and status='APPROVED' and user_id<>auth.uid()) then
     insert into affiliate_attributions(organization_id,affiliate_id,link_id) values(o.id,l.affiliate_id,l.id);
   end if;
 end if;
 return o;
end $$;
revoke all on function public.affiliate_create_organization(text) from public;
grant execute on function public.affiliate_create_organization(text) to authenticated;

create function public.affiliate_balance(p_affiliate uuid) returns jsonb language sql stable set search_path=public as $$
 with totals as (
 select coalesce(sum(amount_paise) filter(where kind in ('APPROVAL','ADJUSTMENT','RESERVATION','RELEASE','PAYOUT_RETURN') or
 (kind='REVERSAL' and exists(select 1 from affiliate_ledger_entries approved where approved.commission_id=affiliate_ledger_entries.commission_id and approved.kind='APPROVAL'))),0)::bigint as available,
 coalesce(sum(-amount_paise) filter(where kind in ('PAYOUT','PAYOUT_RETURN')),0)::bigint as paid
 from affiliate_ledger_entries where affiliate_id=p_affiliate
 ) select jsonb_build_object('available',greatest(available,0)::text,'recoverable',greatest(-available,0)::text,'paid',paid::text) from totals
$$;
revoke all on function public.affiliate_balance(uuid) from public;
grant execute on function public.affiliate_balance(uuid) to service_role;

create function public.affiliate_accrue(p_payment uuid) returns text language plpgsql set search_path=public as $$
declare p public.payments; a public.affiliate_attributions; e public.affiliate_payment_evidence;
 t public.affiliate_tax_evidence; pol public.affiliate_policies; c public.affiliate_commissions;
 n bigint; earned bigint; reversed bigint; previous bigint; correction public.affiliate_attribution_corrections;
begin
 select * into p from payments where id=p_payment;
 select * into a from affiliate_attributions where organization_id=p.organization_id;
 if a.id is null or p.subscription_id is null or p.billing_cycle='ai_credits' or p.currency<>'INR' or
 not exists(select 1 from subscriptions where id=p.subscription_id and organization_id=p.organization_id) then return 'INELIGIBLE'; end if;
 select * into e from affiliate_payment_evidence where payment_id=p_payment order by refunded_paise desc limit 1;
 if e.id is null then return 'CAPTURE_REVIEW'; end if;
 if e.provider_payment_id<>p.razorpay_payment_id or e.amount_paise<>p.amount_paise then return 'CAPTURE_REVIEW'; end if;
 if e.captured_at<a.created_at then return 'INELIGIBLE'; end if;
 select * into correction from affiliate_attribution_corrections where attribution_id=a.id and created_at<=e.captured_at order by created_at desc,id desc limit 1;
 if correction.id is not null then a.affiliate_id:=correction.affiliate_id;a.link_id:=correction.link_id;end if;
 -- Existing commissions retain their original beneficiary, including refund recovery.
 select * into c from affiliate_commissions where payment_id=p_payment;
 if c.id is not null then a.affiliate_id:=c.affiliate_id;end if;
 perform 1 from affiliate_profiles where id=a.affiliate_id for update;
 select * into t from affiliate_tax_evidence where payment_id=p_payment and refunded_paise=e.refunded_paise;
 if t.id is null or t.tax_paise>=e.amount_paise or t.refunded_tax_paise>e.refunded_paise then return 'TAX_REVIEW'; end if;
 n:=e.amount_paise-t.tax_paise;
 if e.refunded_paise-t.refunded_tax_paise>n then return 'TAX_REVIEW'; end if;
 select * into c from affiliate_commissions where payment_id=p_payment;
 if c.id is null then
   select * into pol from affiliate_policies where effective_at<=e.captured_at and
    ((link_id=a.link_id and affiliate_id=a.affiliate_id) or (link_id is null and affiliate_id=a.affiliate_id) or (link_id is null and affiliate_id is null))
    order by (link_id is not null) desc,(affiliate_id is not null) desc,effective_at desc,version desc limit 1;
   if pol.id is null then return 'POLICY_REVIEW'; end if;
   earned:=case when pol.fixed_paise is not null then least(pol.fixed_paise,n) else floor((n::numeric*pol.basis_points+5000)/10000)::bigint end;
   insert into affiliate_commissions(affiliate_id,attribution_id,payment_id,policy_id,policy_snapshot,net_paise,amount_paise,available_at)
   values(a.affiliate_id,a.id,p_payment,pol.id,to_jsonb(pol),n,earned,e.captured_at+make_interval(days=>(select hold_days from affiliate_settings))) returning * into c;
   insert into affiliate_ledger_entries(affiliate_id,commission_id,kind,amount_paise,idempotency_key)
    values(a.affiliate_id,c.id,'ACCRUAL',earned,'accrual:'||p_payment);
 end if;
 if c.net_paise<>n then return 'TAX_REVIEW'; end if;
 -- Approval releases the gross commission; cumulative reversal offsets it in the same transaction.
 if c.available_at<=now() then
   insert into affiliate_ledger_entries(affiliate_id,commission_id,kind,amount_paise,idempotency_key)
    values(a.affiliate_id,c.id,'APPROVAL',c.amount_paise,'approval:'||p_payment) on conflict(idempotency_key) do nothing;
 end if;
   reversed:=floor((c.amount_paise::numeric*(e.refunded_paise-t.refunded_tax_paise)+n/2)/n)::bigint;
   select coalesce(-sum(amount_paise),0) into previous from affiliate_ledger_entries where commission_id=c.id and kind='REVERSAL';
   if reversed>previous then
    insert into affiliate_ledger_entries(affiliate_id,commission_id,kind,amount_paise,idempotency_key)
     values(a.affiliate_id,c.id,'REVERSAL',previous-reversed,'refund:'||p_payment||':'||e.refunded_paise);
   end if;
 return case when c.available_at>now() then 'HOLD' else 'RECONCILED' end;
end $$;
revoke all on function public.affiliate_accrue(uuid) from public;
grant execute on function public.affiliate_accrue(uuid) to service_role;

create function public.affiliate_request_payout(p_affiliate uuid,p_account uuid,p_amount bigint,p_key uuid) returns uuid
language plpgsql set search_path=public as $$
declare existing public.affiliate_payout_requests; result uuid; balance bigint; source record; remaining bigint; portion bigint;
begin
 perform 1 from affiliate_profiles where id=p_affiliate and status='APPROVED' for update;
 if not found then raise exception 'Partner is not approved'; end if;
 select * into existing from affiliate_payout_requests where idempotency_key=p_key;
 if existing.id is not null then
  if existing.affiliate_id<>p_affiliate or existing.amount_paise<>p_amount or existing.account_id<>p_account then raise exception 'Idempotency conflict'; end if;
  return existing.id;
 end if;
 if not exists(select 1 from affiliate_payout_accounts where id=p_account and affiliate_id=p_affiliate) then raise exception 'Invalid payout account'; end if;
 if p_amount<(select minimum_payout_paise from affiliate_settings) then raise exception 'Below minimum payout'; end if;
 balance:=(affiliate_balance(p_affiliate)->>'available')::bigint;
 if p_amount>balance then raise exception 'Insufficient available balance'; end if;
 if exists(select 1 from affiliate_commissions c join affiliate_processing q on q.payment_id=c.payment_id where c.affiliate_id=p_affiliate and (q.status not in ('RECONCILED','HOLD') or q.updated_at<now()-interval '25 hours')) then raise exception 'Reconciliation required'; end if;
 insert into affiliate_payout_requests(affiliate_id,account_id,amount_paise,idempotency_key) values(p_affiliate,p_account,p_amount,p_key) returning id into result;
 insert into affiliate_ledger_entries(affiliate_id,payout_id,kind,amount_paise,idempotency_key) values(p_affiliate,result,'RESERVATION',-p_amount,'reserve:'||result);
 remaining:=p_amount;
 for source in select e.id,e.amount_paise-coalesce((select sum(x.amount_paise) from affiliate_payout_allocations x join affiliate_payout_requests r on r.id=x.payout_id where x.ledger_id=e.id and r.status not in ('REJECTED','RETURNED')),0) as capacity
 from affiliate_ledger_entries e where e.affiliate_id=p_affiliate and e.kind in ('APPROVAL','ADJUSTMENT') and e.amount_paise>0 order by e.created_at,e.id loop
  portion:=least(remaining,source.capacity);
  if portion>0 then insert into affiliate_payout_allocations(payout_id,ledger_id,amount_paise) values(result,source.id,portion);remaining:=remaining-portion;end if;
  exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'Allocation mismatch'; end if;
 insert into affiliate_audit_logs(affiliate_id,action,details) values(p_affiliate,'payout.requested',jsonb_build_object('payout',result));
 return result;
end $$;
revoke all on function public.affiliate_request_payout(uuid,uuid,bigint,uuid) from public;
grant execute on function public.affiliate_request_payout(uuid,uuid,bigint,uuid) to service_role;

create function public.affiliate_settle_payout(p_id uuid,p_action text,p_reference text,p_actor uuid,p_reason text) returns void
language plpgsql set search_path=public as $$
declare p public.affiliate_payout_requests; s text;
begin
 if not exists(select 1 from platform_admins where user_id=p_actor) then raise exception 'Admin required';end if;
 select * into p from affiliate_payout_requests where id=p_id;
 select status into s from affiliate_profiles where id=p.affiliate_id for update;
 select * into p from affiliate_payout_requests where id=p_id for update;
 if p.id is null then raise exception 'Payout not found'; end if;
 if p.status='PAID' and p_action='RETURNED' and length(p_reason)>=3 then
  update affiliate_payout_requests set status='RETURNED' where id=p.id;
  insert into affiliate_ledger_entries(affiliate_id,payout_id,kind,amount_paise,idempotency_key) values(p.affiliate_id,p.id,'PAYOUT_RETURN',p.amount_paise,'return:'||p.id);
  insert into affiliate_audit_logs(affiliate_id,actor_id,action,details) values(p.affiliate_id,p_actor,'payout.RETURNED',jsonb_build_object('payout',p.id,'reason',p_reason));
  return;
 end if;
 if p.status in ('PAID','REJECTED','RETURNED') then
  if p.status=p_action and (p_action<>'PAID' or p.settlement_reference=p_reference) then return; end if;
  raise exception 'Payout already finalized';
 end if;
 if p_action not in ('APPROVED','REJECTED','REVIEW','PAID') or length(p_reason)<3 then raise exception 'Invalid decision'; end if;
 if p_action in ('APPROVED','PAID') and (s<>'APPROVED' or (affiliate_balance(p.affiliate_id)->>'recoverable')::bigint>0) then raise exception 'Payout eligibility requires review'; end if;
 if p_action='PAID' and (p.status<>'APPROVED' or length(coalesce(p_reference,''))<3) then raise exception 'Approval and settlement reference required'; end if;
 if p_action in ('APPROVED','PAID') and exists(select 1 from affiliate_commissions c join affiliate_processing q on q.payment_id=c.payment_id where c.affiliate_id=p.affiliate_id and (q.status not in ('RECONCILED','HOLD') or q.updated_at<now()-interval '25 hours')) then raise exception 'Reconciliation required'; end if;
 update affiliate_payout_requests set status=p_action,settlement_reference=case when p_action='PAID' then p_reference else null end,settled_at=case when p_action='PAID' then now() else null end where id=p_id;
 if p_action in ('PAID','REJECTED') then
  insert into affiliate_ledger_entries(affiliate_id,payout_id,kind,amount_paise,idempotency_key)
   values(p.affiliate_id,p.id,case when p_action='PAID' then 'PAYOUT' else 'RELEASE' end,case when p_action='PAID' then -p.amount_paise else p.amount_paise end,p_action||':'||p.id);
 end if;
 insert into affiliate_audit_logs(affiliate_id,actor_id,action,details) values(p.affiliate_id,p_actor,'payout.'||p_action,jsonb_build_object('payout',p.id,'reason',p_reason));
 insert into affiliate_notifications(affiliate_id,message) values(p.affiliate_id,'Payout status: '||p_action);
end $$;
revoke all on function public.affiliate_settle_payout(uuid,text,text,uuid,text) from public;
grant execute on function public.affiliate_settle_payout(uuid,text,text,uuid,text) to service_role;

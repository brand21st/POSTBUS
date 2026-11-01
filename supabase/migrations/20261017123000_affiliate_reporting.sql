-- Conversion reporting is independent of tax approval and commission maturity.
create view public.affiliate_conversions with (security_invoker=true) as
select p.id as payment_id,a.id as attribution_id,a.affiliate_id,min(e.captured_at) as captured_at
from affiliate_payment_evidence e join payments p on p.id=e.payment_id
join affiliate_attributions a on a.organization_id=p.organization_id
group by p.id,a.id,a.affiliate_id;
revoke all on public.affiliate_conversions from public,anon,authenticated;
grant select on public.affiliate_conversions to service_role;

create function public.affiliate_partner_records(p_affiliate uuid,p_type text,p_offset integer,p_query text default '',p_status text default '',p_from timestamptz default null,p_to timestamptz default null) returns jsonb
language plpgsql stable set search_path=public as $$
declare result jsonb; needle text:=replace(replace(coalesce(p_query,''),'%','!%'),'_','!_');
begin
 if p_type='referrals' then
 select coalesce(jsonb_agg(x),'[]') into result from (
 select 'Merchant '||left(a.id::text,8) as merchant,a.created_at as signup_at,'ATTRIBUTED' as signup_status,
 (select s.status from subscriptions s where s.organization_id=a.organization_id order by s.created_at desc limit 1) as subscription_status,
 exists(select 1 from affiliate_conversions c where c.attribution_id=a.id) as paid_conversion,
 case when exists(select 1 from affiliate_commissions c join affiliate_ledger_entries e on e.commission_id=c.id and e.kind='REVERSAL' where c.attribution_id=a.id) then 'REVERSED'
 when exists(select 1 from affiliate_commissions c where c.attribution_id=a.id) then 'ACCRUED' else 'NONE' end as commission_status,
 (select coalesce(sum(c.amount_paise),0)::text from affiliate_commissions c where c.attribution_id=a.id) as earned_paise
 from affiliate_attributions a where a.affiliate_id=p_affiliate
 and (p_from is null or a.created_at>=p_from) and (p_to is null or a.created_at<=p_to)
 and (needle='' or ('Merchant '||left(a.id::text,8)) ilike '%'||needle||'%' escape '!')
 and (p_status='' or coalesce((select s.status from subscriptions s where s.organization_id=a.organization_id order by s.created_at desc limit 1),'')=p_status)
 order by a.created_at desc limit 25 offset greatest(p_offset,0)) x;
 elsif p_type='commissions' then
 select coalesce(jsonb_agg(x),'[]') into result from (
 select * from (
 select 'recurring' as commission_type,'Payment '||left(c.payment_id::text,8) as payment_reference,c.amount_paise::text,c.available_at,c.created_at,
 case when coalesce((select -sum(e.amount_paise) from affiliate_ledger_entries e where e.commission_id=c.id and e.kind='REVERSAL'),0)>=c.amount_paise then 'REVERSED'
 when coalesce((select sum(x.amount_paise) from affiliate_payout_allocations x join affiliate_ledger_entries e on e.id=x.ledger_id join affiliate_payout_requests r on r.id=x.payout_id where e.commission_id=c.id and r.status='PAID'),0)>=c.amount_paise then 'PAID'
 when exists(select 1 from affiliate_ledger_entries e where e.commission_id=c.id and e.kind='APPROVAL') then 'PAYABLE' else 'PENDING' end as status
 from affiliate_commissions c where c.affiliate_id=p_affiliate
 and (p_from is null or c.created_at>=p_from) and (p_to is null or c.created_at<=p_to)
 ) rows where (p_status='' or rows.status=p_status) and (needle='' or rows.payment_reference ilike '%'||needle||'%' escape '!')
 order by rows.created_at desc limit 25 offset greatest(p_offset,0)) x;
 else raise exception 'Invalid report';end if;
 return result;
end $$;
create function public.affiliate_admin_overview() returns jsonb language sql stable set search_path=public as $$
 select jsonb_build_object('partners',(select count(*) from affiliate_profiles),'active',(select count(*) from affiliate_profiles where status='APPROVED'),
 'applications',(select count(*) from affiliate_profiles where status='PENDING'),'links',(select count(*) from affiliate_links where enabled),
 'signups',(select count(*) from affiliate_attributions),
 'paidMerchants',(select count(distinct attribution_id) from affiliate_conversions),'earned',(select coalesce(sum(amount_paise),0)::text from affiliate_commissions),
 'paid',(select coalesce(-sum(amount_paise),0)::text from affiliate_ledger_entries where kind in ('PAYOUT','PAYOUT_RETURN')),
 'liabilities',(select coalesce(sum(amount_paise),0)::text from affiliate_ledger_entries where kind in ('ACCRUAL','REVERSAL','ADJUSTMENT','PAYOUT','PAYOUT_RETURN')),
 'review',(select count(*) from affiliate_processing where status like '%REVIEW' or status='RETRY'))
$$;
revoke all on function public.affiliate_partner_records(uuid,text,integer,text,text,timestamptz,timestamptz) from public;
revoke all on function public.affiliate_admin_overview() from public;
grant execute on function public.affiliate_partner_records(uuid,text,integer,text,text,timestamptz,timestamptz),public.affiliate_admin_overview() to service_role;

-- Pseudonymous analytics retention. Financial evidence is deliberately excluded.
create function public.affiliate_prune_visits() returns void language sql set search_path=public as $$
 delete from affiliate_click_events where created_at<now()-interval '366 days';
$$;
revoke all on function public.affiliate_prune_visits() from public;
grant execute on function public.affiliate_prune_visits() to service_role;

create function public.affiliate_profile_history() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if TG_OP='INSERT' then
 insert into affiliate_audit_logs(affiliate_id,actor_id,action,details) values(new.id,new.user_id,'application.submitted',jsonb_build_object('termsVersion',new.terms_version));
 if exists(select 1 from affiliate_profiles p where p.id<>new.id and p.application->>'mobile'=new.application->>'mobile') then
 insert into affiliate_audit_logs(affiliate_id,action,details) values(new.id,'risk.identity_overlap','{"reviewRequired":true}');
 end if;
 elsif new.application is distinct from old.application then
 insert into affiliate_audit_logs(affiliate_id,actor_id,action) values(new.id,new.user_id,'profile.updated');
 end if;
 return new;
end $$;
create trigger affiliate_profile_history after insert or update on public.affiliate_profiles for each row execute function public.affiliate_profile_history();

create function public.affiliate_bind_signup(p_user uuid,p_link uuid,p_expires timestamptz) returns void
language plpgsql set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 -- Claims can be bound only at account creation, never after merchant onboarding.
 if not exists(select 1 from auth.users where id=p_user and created_at>now()-interval '10 minutes') or
 exists(select 1 from organization_members where user_id=p_user) then return; end if;
 if not exists(select 1 from affiliate_links l join affiliate_profiles a on a.id=l.affiliate_id
 where l.id=p_link and l.enabled and a.status='APPROVED' and a.user_id<>p_user) then return; end if;
 insert into affiliate_signup_claims(user_id,link_id,expires_at) values(p_user,p_link,least(p_expires,now()+interval '90 days')) on conflict(user_id) do nothing;
end $$;

create function public.affiliate_capture_time(p_provider_payment text) returns timestamptz
language sql stable set search_path=public as $$
 select min(to_timestamp((payload->>'created_at')::bigint)) from razorpay_webhook_events
 where event in ('payment.captured','subscription.charged','invoice.paid')
 and payload#>>'{payload,payment,entity,id}'=p_provider_payment
 and payload#>>'{payload,payment,entity,status}'='captured'
 and payload->>'created_at' ~ '^[0-9]{1,12}$'
$$;

create function public.affiliate_claim_payments(p_limit integer) returns setof public.affiliate_processing
language plpgsql set search_path=public as $$
begin
 insert into affiliate_processing(payment_id)
 select p.id from payments p join affiliate_attributions a on a.organization_id=p.organization_id
 where p.subscription_id is not null and p.razorpay_payment_id is not null and p.created_at>=a.created_at
 on conflict(payment_id) do nothing;
 return query update affiliate_processing x set attempts=x.attempts+1, lease=gen_random_uuid(),status='PROCESSING',next_attempt_at=now()+interval '10 minutes',updated_at=now()
 where x.payment_id in (select q.payment_id from affiliate_processing q where q.next_attempt_at<=now()
 order by q.next_attempt_at for update skip locked limit least(greatest(p_limit,1),50)) returning x.*;
end $$;
create index affiliate_processing_due on public.affiliate_processing(next_attempt_at);
grant usage,select on sequence public.affiliate_policies_version_seq to service_role;
create index affiliate_inbox_payment on public.razorpay_webhook_events((payload#>>'{payload,payment,entity,id}'));

create function public.affiliate_summary(p_affiliate uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object(
 'balance',affiliate_balance(p_affiliate),
 'clicks',(select count(*) from affiliate_click_events where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'visitors',(select count(distinct visitor) from affiliate_click_events where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'signups',(select count(*) from affiliate_attributions where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'conversions',(select count(distinct a.id) from affiliate_payment_evidence e join payments p on p.id=e.payment_id join affiliate_attributions a on a.organization_id=p.organization_id where a.affiliate_id=p_affiliate and e.captured_at between p_from and p_to),
 'earned',(select coalesce(sum(amount_paise),0)::text from affiliate_commissions where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'pending',(select coalesce(sum(c.amount_paise+coalesce((select sum(r.amount_paise) from affiliate_ledger_entries r where r.commission_id=c.id and r.kind='REVERSAL'),0)),0)::text from affiliate_commissions c where affiliate_id=p_affiliate and not exists(select 1 from affiliate_ledger_entries e where e.commission_id=c.id and e.kind='APPROVAL')),
 'reserved',(select coalesce(sum(amount_paise),0)::text from affiliate_payout_requests where affiliate_id=p_affiliate and status in ('REQUESTED','APPROVED','REVIEW')),
 'daily',coalesce((select jsonb_agg(x) from (select date_trunc('day',created_at) as day,count(*) as clicks from affiliate_click_events where affiliate_id=p_affiliate and created_at between p_from and p_to group by 1 order by 1) x),'[]'::jsonb),
 'activity',coalesce((select jsonb_agg(x) from (
 select date_trunc('day',day) as day,sum(signups) as signups,sum(conversions) as conversions,sum(earnings)::text as earnings from (
 select created_at as day,1 as signups,0 as conversions,0::bigint as earnings from affiliate_attributions where affiliate_id=p_affiliate and created_at between p_from and p_to
 union all select c.created_at,0,0,c.amount_paise from affiliate_commissions c where c.affiliate_id=p_affiliate and c.created_at between p_from and p_to
 union all select min(e.captured_at),0,1,0 from affiliate_payment_evidence e join payments p on p.id=e.payment_id join affiliate_attributions a on a.organization_id=p.organization_id where a.affiliate_id=p_affiliate and e.captured_at between p_from and p_to group by e.payment_id
 ) entries group by 1 order by 1) x),'[]'::jsonb))
$$;

-- All sensitive administrative mutations and their audit record commit together.
create function public.affiliate_admin_action(p_actor uuid,p_action text,p_id uuid,p_data jsonb) returns void
language plpgsql set search_path=public as $$
declare a uuid; reason text:=p_data->>'reason';
begin
 if not exists(select 1 from platform_admins where user_id=p_actor) then raise exception 'Admin required'; end if;
 if length(coalesce(reason,''))<3 then raise exception 'Reason required'; end if;
 if p_action='status' then
   if p_data->>'status' not in ('APPROVED','REJECTED','SUSPENDED') then raise exception 'Invalid status'; end if;
   update affiliate_profiles set status=p_data->>'status',rejection_reason=case when p_data->>'status'='REJECTED' then reason else null end where id=p_id returning id into a;
   if a is null then raise exception 'Partner not found'; end if;
   if p_data->>'status'='APPROVED' then
    insert into affiliate_links(affiliate_id,code,campaign) values(a,substr(replace(gen_random_uuid()::text,'-',''),1,24),'') on conflict(affiliate_id,campaign) do nothing;
   end if;
   insert into affiliate_notifications(affiliate_id,message) values(a,'Application status: '||(p_data->>'status')||'. '||reason);
 elsif p_action='correction' then
   a:=(p_data->>'affiliateId')::uuid;
   perform 1 from affiliate_attributions where id=p_id for update;
   if not exists(select 1 from affiliate_links l join affiliate_profiles p on p.id=l.affiliate_id where l.id=(p_data->>'linkId')::uuid and l.affiliate_id=a and l.enabled and p.status='APPROVED') then raise exception 'Invalid partner or link';end if;
   if exists(select 1 from affiliate_attributions t join organization_members m on m.organization_id=t.organization_id join affiliate_profiles p on p.user_id=m.user_id where t.id=p_id and p.id=a) then raise exception 'Self referral';end if;
   insert into affiliate_attribution_corrections(attribution_id,affiliate_id,link_id,actor_id,reason) values(p_id,a,(p_data->>'linkId')::uuid,p_actor,reason);
 elsif p_action='policy' then
   a:=nullif(p_data->>'affiliateId','')::uuid;
   if nullif(p_data->>'linkId','') is not null and not exists(select 1 from affiliate_links where id=(p_data->>'linkId')::uuid and affiliate_id=a) then raise exception 'Invalid campaign'; end if;
   insert into affiliate_policies(affiliate_id,link_id,basis_points,fixed_paise) values(a,nullif(p_data->>'linkId','')::uuid,(p_data->>'basisPoints')::integer,nullif(p_data->>'fixedPaise','')::bigint);
 elsif p_action='tax' then
   insert into affiliate_tax_evidence(payment_id,refunded_paise,tax_paise,refunded_tax_paise,reason,actor_id)
    values(p_id,(p_data->>'refundedPaise')::bigint,(p_data->>'taxPaise')::bigint,(p_data->>'refundedTaxPaise')::bigint,reason,p_actor);
   update affiliate_processing set next_attempt_at=now() where payment_id=p_id;
 elsif p_action='adjustment' then
   a:=p_id;
   perform 1 from affiliate_profiles where id=a for update;
   insert into affiliate_ledger_entries(affiliate_id,kind,amount_paise,idempotency_key) values(a,'ADJUSTMENT',(p_data->>'amountPaise')::bigint,'adjust:'||(p_data->>'key'));
 elsif p_action='link' then
   update affiliate_links set enabled=(p_data->>'enabled')::boolean where id=p_id returning affiliate_id into a;
 elsif p_action='settings' then
   update affiliate_settings set registration_open=(p_data->>'registrationOpen')::boolean,attribution_days=(p_data->>'attributionDays')::integer,
    hold_days=(p_data->>'holdDays')::integer,minimum_payout_paise=(p_data->>'minimumPayoutPaise')::bigint where id=true;
 else raise exception 'Unsupported action'; end if;
 insert into affiliate_audit_logs(affiliate_id,actor_id,action,details) values(a,p_actor,p_action,p_data-'pin');
end $$;

create function public.affiliate_record_click(p_link uuid,p_visitor text) returns void language plpgsql set search_path=public as $$
declare a uuid;
begin
 if p_visitor !~ '^[0-9a-f]{32}$' then return; end if;
 select l.affiliate_id into a from affiliate_links l join affiliate_profiles p on p.id=l.affiliate_id where l.id=p_link and l.enabled and p.status='APPROVED';
 if a is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_link::text||p_visitor,0));
 if exists(select 1 from affiliate_click_events where link_id=p_link and visitor=p_visitor and created_at>now()-interval '1 minute') then return; end if;
 insert into affiliate_click_events(affiliate_id,link_id,visitor) values(a,p_link,p_visitor);
end $$;
revoke all on function public.affiliate_record_click(uuid,text) from public;
grant execute on function public.affiliate_record_click(uuid,text) to service_role;

do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('affiliate_bind_signup','affiliate_capture_time','affiliate_claim_payments','affiliate_summary','affiliate_admin_action') loop
 execute format('revoke all on function %s from public',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Read-only Phase 2 reconciliation. Does not insert commissions or tax rows.
create or replace function public.affiliate_summary(p_affiliate uuid,p_from timestamptz,p_to timestamptz) returns jsonb
language sql stable set search_path=public as $$
 select jsonb_build_object(
 'balance',affiliate_balance(p_affiliate),
 'clicks',(select count(*) from affiliate_click_events where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'visitors',(select count(distinct visitor) from affiliate_click_events where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'signups',(select count(*) from affiliate_attributions where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'conversions',(select count(distinct a.id) from affiliate_payment_evidence e join payments p on p.id=e.payment_id join affiliate_attributions a on a.organization_id=p.organization_id where a.affiliate_id=p_affiliate and e.captured_at between p_from and p_to),
 'earned',(select coalesce(sum(amount_paise),0)::text from affiliate_commissions where affiliate_id=p_affiliate and created_at between p_from and p_to),
 'reversed',(select coalesce(-sum(amount_paise),0)::text from affiliate_ledger_entries where affiliate_id=p_affiliate and kind='REVERSAL' and created_at between p_from and p_to),
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

create or replace function public.affiliate_reconciliation_report(p_limit integer default 50) returns jsonb
language sql stable set search_path=public as $$
 select coalesce(jsonb_agg(item order by item->>'category'),'[]'::jsonb) from (
  select jsonb_build_object(
   'payment', left(p.id::text,8),
   'cycle', coalesce(p.billing_cycle,''),
   'category', case
    when p.subscription_id is null or p.billing_cycle='ai_credits'
      or not exists(select 1 from subscriptions s where s.id=p.subscription_id and s.organization_id=p.organization_id)
      then 'OWNERSHIP_MISMATCH'
    when e.id is null then 'PAYMENT_UNVERIFIED'
    when t.id is null then 'MISSING_TAX_EVIDENCE'
    when c.id is null then 'MISSING_COMMISSION'
    when e.refunded_paise>0 and not exists(select 1 from affiliate_ledger_entries r where r.commission_id=c.id and r.kind='REVERSAL') then 'REFUND_REVIEW'
    when exists(select 1 from affiliate_ledger_entries accrual where accrual.commission_id=c.id and accrual.kind='ACCRUAL' and accrual.amount_paise<>c.amount_paise) then 'LEDGER_MISMATCH'
    else 'MATCHED'
   end
  ) as item
  from payments p
  join affiliate_attributions a on a.organization_id=p.organization_id
  left join lateral (
   select * from affiliate_payment_evidence evidence where evidence.payment_id=p.id order by evidence.refunded_paise desc limit 1
  ) e on true
  left join affiliate_tax_evidence t on t.payment_id=p.id and t.refunded_paise=coalesce(e.refunded_paise,0)
  left join affiliate_commissions c on c.payment_id=p.id
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit,50),1),100)
 ) classified
$$;

revoke all on function public.affiliate_summary(uuid,timestamptz,timestamptz) from public;
revoke all on function public.affiliate_reconciliation_report(integer) from public;
grant execute on function public.affiliate_summary(uuid,timestamptz,timestamptz), public.affiliate_reconciliation_report(integer) to service_role;

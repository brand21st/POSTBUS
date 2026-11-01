-- Partner portal reporting only. Does not insert commissions, tax, or payouts.
-- Local file. Do not apply remotely without separate authorization.

alter table public.affiliate_links
  add column if not exists landing_path text not null default '/',
  add column if not exists utm_source text not null default '',
  add column if not exists utm_medium text not null default '',
  add column if not exists utm_campaign text not null default '';

alter table public.affiliate_links
  drop constraint if exists affiliate_links_landing_path_check;
alter table public.affiliate_links
  add constraint affiliate_links_landing_path_check
  check (landing_path in ('/','/pricing','/partner'));

create index if not exists affiliate_links_affiliate_created_idx
  on public.affiliate_links (affiliate_id, created_at desc);

create or replace function public.affiliate_partner_link_stats(p_affiliate uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(row order by row->>'created_at' desc), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', l.id,
      'code', l.code,
      'campaign', l.campaign,
      'enabled', l.enabled,
      'landingPath', l.landing_path,
      'utmSource', l.utm_source,
      'utmMedium', l.utm_medium,
      'utmCampaign', l.utm_campaign,
      'created_at', l.created_at,
      'clicks', (select count(*) from affiliate_click_events e where e.link_id = l.id),
      'signups', (select count(*) from affiliate_attributions a where a.link_id = l.id),
      'conversions', (
        select count(distinct a.id)
        from affiliate_attributions a
        join payments p on p.organization_id = a.organization_id
        join affiliate_payment_evidence e on e.payment_id = p.id
        where a.link_id = l.id
      )
    ) as row
    from affiliate_links l
    where l.affiliate_id = p_affiliate
  ) stats;
$$;

create or replace function public.affiliate_partner_records(
  p_affiliate uuid,
  p_type text,
  p_offset integer,
  p_query text default '',
  p_status text default '',
  p_from timestamptz default null,
  p_to timestamptz default null
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  result jsonb;
  needle text := replace(replace(coalesce(p_query, ''), '%', '!%'), '_', '!_');
begin
  if p_type = 'referrals' then
    select coalesce(jsonb_agg(x), '[]') into result from (
      select
        'Merchant ' || left(a.id::text, 8) as merchant,
        a.created_at as signup_at,
        'ATTRIBUTED' as signup_status,
        (select s.status from subscriptions s where s.organization_id = a.organization_id order by s.created_at desc limit 1) as subscription_status,
        exists(select 1 from affiliate_conversions c where c.attribution_id = a.id) as paid_conversion,
        case
          when exists(select 1 from affiliate_commissions c join affiliate_ledger_entries e on e.commission_id = c.id and e.kind = 'REVERSAL' where c.attribution_id = a.id) then 'REVERSED'
          when exists(select 1 from affiliate_commissions c where c.attribution_id = a.id) then 'ACCRUED'
          else 'NONE'
        end as commission_status,
        (select coalesce(sum(c.amount_paise), 0)::text from affiliate_commissions c where c.attribution_id = a.id) as earned_paise
      from affiliate_attributions a
      where a.affiliate_id = p_affiliate
        and (p_from is null or a.created_at >= p_from)
        and (p_to is null or a.created_at <= p_to)
        and (needle = '' or ('Merchant ' || left(a.id::text, 8)) ilike '%' || needle || '%' escape '!')
        and (
          p_status = ''
          or (p_status = 'PAID' and exists(select 1 from affiliate_conversions c where c.attribution_id = a.id))
          or (p_status = 'UNPAID' and not exists(select 1 from affiliate_conversions c where c.attribution_id = a.id))
          or coalesce((select s.status from subscriptions s where s.organization_id = a.organization_id order by s.created_at desc limit 1), '') = p_status
        )
      order by a.created_at desc
      limit 25 offset greatest(p_offset, 0)
    ) x;
  elsif p_type = 'commissions' then
    select coalesce(jsonb_agg(x), '[]') into result from (
      select * from (
        select
          'recurring' as commission_type,
          'Payment ' || left(c.payment_id::text, 8) as payment_reference,
          c.amount_paise::text,
          (c.policy_snapshot->>'basisPoints') as rate_basis_points,
          c.available_at,
          c.created_at,
          case
            when coalesce((select -sum(e.amount_paise) from affiliate_ledger_entries e where e.commission_id = c.id and e.kind = 'REVERSAL'), 0) >= c.amount_paise then 'REVERSED'
            when coalesce((
              select sum(x.amount_paise)
              from affiliate_payout_allocations x
              join affiliate_ledger_entries e on e.id = x.ledger_id
              join affiliate_payout_requests r on r.id = x.payout_id
              where e.commission_id = c.id and r.status = 'PAID'
            ), 0) >= c.amount_paise then 'PAID'
            when exists(select 1 from affiliate_ledger_entries e where e.commission_id = c.id and e.kind = 'APPROVAL') then 'PAYABLE'
            else 'PENDING'
          end as status
        from affiliate_commissions c
        where c.affiliate_id = p_affiliate
          and (p_from is null or c.created_at >= p_from)
          and (p_to is null or c.created_at <= p_to)
      ) rows
      where (p_status = '' or rows.status = p_status)
        and (needle = '' or rows.payment_reference ilike '%' || needle || '%' escape '!')
      order by rows.created_at desc
      limit 25 offset greatest(p_offset, 0)
    ) x;
  else
    raise exception 'Invalid report';
  end if;
  return result;
end
$$;

revoke all on function public.affiliate_partner_link_stats(uuid) from public;
grant execute on function public.affiliate_partner_link_stats(uuid) to service_role;
revoke all on function public.affiliate_partner_records(uuid, text, integer, text, text, timestamptz, timestamptz) from public;
grant execute on function public.affiliate_partner_records(uuid, text, integer, text, text, timestamptz, timestamptz) to service_role;

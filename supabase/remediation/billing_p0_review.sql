-- Billing P0 remediation PREVIEW. Read-only: run first, review every row.
-- Shows exactly which rows billing_p0_remediation.sql would change and why.
-- Safe on production (SELECT only). Returns no personal data.

-- A. ACTIVE (or other live) subscriptions with no captured subscription payment at all.
--    Candidates for "unpaid activation reverted". Admin-granted plans also appear here:
--    confirm with Super Admin audit logs (billing_audit_logs action 'subscription.plan_changed')
--    before reverting any of them.
select s.id, s.status, p.slug as plan, s.amount_paise, s.current_period_end, s.trial_cohort,
       s.trial_manual_override,
       exists (select 1 from billing_audit_logs a
               where a.organization_id = s.organization_id and a.action = 'subscription.plan_changed') as admin_assigned,
       (select string_agg(distinct h.reason, ',') from subscription_history h where h.subscription_id = s.id) as history_reasons
from subscriptions s
join plans p on p.id = s.plan_id
where s.status in ('ACTIVE', 'PAST_DUE', 'PAUSED', 'PAYMENT_FAILED')
  and not exists (
    select 1 from payments x
    where x.subscription_id = s.id and x.status = 'CAPTURED'
      and coalesce(x.payment_purpose, 'subscription') = 'subscription'
  );

-- B. Old-code fingerprints (checkout start rewrote the plan; resume forced ACTIVE).
select subscription_id, count(*) as plan_rewrites, min(created_at), max(created_at)
from subscription_history
where reason = 'checkout_started' and from_plan_id is distinct from to_plan_id
  and coalesce(metadata ->> 'intendedPlanId', '') = ''
group by subscription_id;
select subscription_id, from_status, to_status, created_at
from subscription_history
where reason = 'resumed' and to_status = 'ACTIVE' and from_status <> 'ACTIVE';

-- C. One-time ACTIVE periods that have ended (access already stops in code; status still ACTIVE).
select s.id, p.slug, s.amount_paise, s.current_period_end,
       exists (select 1 from payments x where x.subscription_id = s.id and x.status = 'CAPTURED') as has_captured_payment
from subscriptions s join plans p on p.id = s.plan_id
where s.status = 'ACTIVE' and s.razorpay_subscription_id is null and s.current_period_end <= now();

-- D. Merchants who joined before 2026-11-01 00:00 IST but hold a rolling 7-day trial.
select s.id, s.status, s.trial_manual_override, s.trial_end,
       (timezone('Asia/Kolkata', o.created_at))::date as joined_ist,
       exists (select 1 from payments x where x.organization_id = s.organization_id and x.status = 'CAPTURED'
               and coalesce(x.payment_purpose, 'subscription') = 'subscription') as has_captured_payment
from subscriptions s join organizations o on o.id = s.organization_id
where s.trial_cohort = 'rolling_7d'
  and s.status = 'TRIAL'
  and o.created_at < timestamptz '2026-11-01 00:00:00+05:30'
order by o.created_at;

-- E. Orders with more than one payments row (legacy FAILED attempt rows) and duplicate intents.
select razorpay_order_id, count(*) as rows, array_agg(status order by created_at) as statuses
from payments
where razorpay_order_id is not null
group by razorpay_order_id having count(*) > 1;

-- F. Stale PENDING subscription purchases. Do NOT treat these as unpaid: the reconciliation
--    job (or scripts/billing/razorpay-pending-audit.mjs) must check Razorpay first.
select count(*) as stale_pending,
       min(created_at) as oldest, max(created_at) as newest
from payments
where status = 'PENDING' and coalesce(payment_purpose, 'subscription') = 'subscription'
  and created_at < now() - interval '30 minutes';

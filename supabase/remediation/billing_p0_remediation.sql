-- Billing P0 remediation. REVIEWED DML — DO NOT RUN WITHOUT WRITTEN OWNER APPROVAL.
--
-- Prerequisites:
--   1. Migration 20261101100000_billing_p0_hardening.sql applied.
--   2. billing_p0_review.sql run and every candidate row reviewed.
--   3. Stale PENDING orders for the affected organizations checked against Razorpay
--      (scripts/billing/razorpay-pending-audit.mjs) so no paid customer is downgraded.
--   4. A database backup / PITR point noted.
--
-- Every change is recorded in public.billing_remediation_log (full row before/after)
-- and in subscription_history, and is reversible with billing_p0_remediation_revert.sql.
-- Each section re-checks its safety predicates at run time, so a row that changed
-- since review (for example a customer paid) is skipped.
--
-- Sections:
--   A. Revert the confirmed unpaid activation (audit F-04): 661ff3ca.
--   B. Expire one-time ACTIVE periods that already ended (optional; access already stops in code).
--   C. Apply the Nov 1 policy to merchants who joined Oct 27-31 (audit F-09).
--      v_policy_end defaults to 2026-11-01 00:00 IST. To give a grace period instead,
--      set v_policy_end to the agreed date before running.

create table if not exists public.billing_remediation_log (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null,
  section text not null,
  table_name text not null,
  row_id uuid not null,
  before jsonb not null,
  after jsonb,
  reverted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.billing_remediation_log enable row level security;

begin;

do $$
declare
  v_batch text := 'billing_p0_20261101';
  -- Change only after owner approval (e.g. a grace date such as '2026-11-04 00:00:00+05:30').
  v_policy_end timestamptz := timestamptz '2026-11-01 00:00:00+05:30';
  v_run_section_b boolean := false;
  r record;
  v_after jsonb;
begin
  if exists (select 1 from public.billing_remediation_log where batch_id = v_batch and reverted_at is null) then
    raise exception 'Batch % already applied. Revert it first or use a new batch id.', v_batch;
  end if;

  -- A. Unpaid ACTIVE created by the pre-2026-10-30 checkout/resume code.
  for r in
    select s.*
    from public.subscriptions s
    where s.id::text like '661ff3ca%'
      and s.status = 'ACTIVE'
      and not exists (
        select 1 from public.payments x
        where x.organization_id = s.organization_id and x.status = 'CAPTURED'
          and coalesce(x.payment_purpose, 'subscription') = 'subscription'
      )
    for update
  loop
    update public.subscriptions
    set status = 'EXPIRED', updated_at = now()
    where id = r.id
    returning to_jsonb(subscriptions.*) into v_after;
    insert into public.billing_remediation_log (batch_id, section, table_name, row_id, before, after)
    values (v_batch, 'A_unpaid_activation', 'subscriptions', r.id, to_jsonb(r), v_after);
    insert into public.subscription_history (organization_id, subscription_id, from_status, to_status, from_plan_id, to_plan_id, reason, actor, metadata)
    values (r.organization_id, r.id, r.status, 'EXPIRED', r.plan_id, r.plan_id,
            'remediation_unpaid_activation_reverted', 'SYSTEM',
            jsonb_build_object('batch', v_batch, 'finding', 'F-04', 'previousAmountPaise', r.amount_paise));
  end loop;

  -- B. One-time paid periods that ended (status hygiene only).
  if v_run_section_b then
    for r in
      select s.* from public.subscriptions s
      where s.status = 'ACTIVE'
        and s.razorpay_subscription_id is null
        and s.current_period_end <= now()
      for update
    loop
      update public.subscriptions set status = 'EXPIRED', updated_at = now()
      where id = r.id returning to_jsonb(subscriptions.*) into v_after;
      insert into public.billing_remediation_log (batch_id, section, table_name, row_id, before, after)
      values (v_batch, 'B_one_time_period_ended', 'subscriptions', r.id, to_jsonb(r), v_after);
      insert into public.subscription_history (organization_id, subscription_id, from_status, to_status, reason, actor, metadata)
      values (r.organization_id, r.id, r.status, 'EXPIRED', 'period_ended', 'SYSTEM', jsonb_build_object('batch', v_batch));
    end loop;
  end if;

  -- C. Nov 1 policy: joined before 2026-11-01 00:00 IST means no rolling trial.
  --    Skips admin overrides and any organization with a captured subscription payment.
  for r in
    select s.*
    from public.subscriptions s
    join public.organizations o on o.id = s.organization_id
    where s.trial_cohort = 'rolling_7d'
      and s.status = 'TRIAL'
      and coalesce(s.trial_manual_override, false) = false
      and o.created_at < timestamptz '2026-11-01 00:00:00+05:30'
      and coalesce(s.trial_end, s.current_period_end) > v_policy_end
      and not exists (
        select 1 from public.payments x
        where x.organization_id = s.organization_id and x.status = 'CAPTURED'
          and coalesce(x.payment_purpose, 'subscription') = 'subscription'
      )
    for update of s
  loop
    update public.subscriptions
    set trial_end = v_policy_end,
        current_period_end = v_policy_end,
        expires_at = v_policy_end,
        renews_at = v_policy_end,
        trial_cohort = 'legacy_nov1',
        updated_at = now()
    where id = r.id
    returning to_jsonb(subscriptions.*) into v_after;
    insert into public.billing_remediation_log (batch_id, section, table_name, row_id, before, after)
    values (v_batch, 'C_nov1_policy', 'subscriptions', r.id, to_jsonb(r), v_after);
    insert into public.subscription_history (organization_id, subscription_id, from_status, to_status, reason, actor, metadata)
    values (r.organization_id, r.id, r.status, r.status, 'remediation_nov1_policy', 'SYSTEM',
            jsonb_build_object('batch', v_batch, 'finding', 'F-09', 'previousTrialEnd', r.trial_end, 'newTrialEnd', v_policy_end));
  end loop;
end $$;

-- Review the counts below, then COMMIT (or ROLLBACK to discard).
select section, count(*) from public.billing_remediation_log
where batch_id = 'billing_p0_20261101' and reverted_at is null group by section;

-- commit;
-- rollback;

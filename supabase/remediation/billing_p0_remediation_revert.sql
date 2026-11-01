-- Revert billing_p0_remediation.sql (batch billing_p0_20261101). Owner approval required.
-- Restores only the columns the remediation changed, and only when the row still has
-- the remediated values (a row that changed afterwards, e.g. a new payment, is skipped
-- and listed for manual review).

begin;

do $$
declare
  v_batch text := 'billing_p0_20261101';
  r record;
  v_now jsonb;
begin
  for r in
    select * from public.billing_remediation_log
    where batch_id = v_batch and reverted_at is null and table_name = 'subscriptions'
    order by created_at desc
  loop
    select to_jsonb(s.*) into v_now from public.subscriptions s where s.id = r.row_id for update;
    if v_now is null
       or v_now ->> 'status' is distinct from r.after ->> 'status'
       or v_now ->> 'current_period_end' is distinct from r.after ->> 'current_period_end'
       or v_now ->> 'trial_end' is distinct from r.after ->> 'trial_end' then
      raise notice 'Skipped % (%): row changed after remediation; review manually.', r.row_id, r.section;
      continue;
    end if;
    update public.subscriptions
    set status = r.before ->> 'status',
        trial_end = (r.before ->> 'trial_end')::timestamptz,
        current_period_end = (r.before ->> 'current_period_end')::timestamptz,
        expires_at = (r.before ->> 'expires_at')::timestamptz,
        renews_at = (r.before ->> 'renews_at')::timestamptz,
        trial_cohort = r.before ->> 'trial_cohort',
        updated_at = now()
    where id = r.row_id;
    insert into public.subscription_history (organization_id, subscription_id, from_status, to_status, reason, actor, metadata)
    values ((r.before ->> 'organization_id')::uuid, r.row_id, v_now ->> 'status', r.before ->> 'status',
            'remediation_reverted', 'SYSTEM', jsonb_build_object('batch', v_batch, 'section', r.section));
    update public.billing_remediation_log set reverted_at = now() where id = r.id;
  end loop;
end $$;

select section, count(*) filter (where reverted_at is not null) as reverted, count(*) filter (where reverted_at is null) as remaining
from public.billing_remediation_log where batch_id = 'billing_p0_20261101' group by section;

-- commit;
-- rollback;

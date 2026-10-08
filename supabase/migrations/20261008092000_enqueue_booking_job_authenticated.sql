-- Merchants create orders with the signed-in JWT client. The booking enqueue
-- RPC was service_role-only, so Save failed after the order row was inserted.

create or replace function public.enqueue_shipment_booking_job(
  p_organization_id uuid,
  p_entity_id uuid,
  p_user_id uuid default null,
  p_progress jsonb default '{}'::jsonb
)
returns public.background_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.background_jobs;
  v_inserted public.background_jobs;
begin
  if auth.uid() is not null
     and not public.has_org_role(
       p_organization_id,
       array['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR']::public.member_role[]
     ) then
    raise exception 'Not allowed to enqueue booking jobs for this workspace.';
  end if;

  select *
    into v_existing
    from public.background_jobs
   where organization_id = p_organization_id
     and job_type = 'shipment-booking'
     and entity_type = 'shipment'
     and entity_id = p_entity_id
     and status in ('PENDING', 'QUEUED', 'RUNNING', 'RETRYING')
   order by created_at asc
   limit 1;
  if found then
    return v_existing;
  end if;

  insert into public.background_jobs (
    organization_id,
    job_type,
    entity_type,
    entity_id,
    status,
    created_by,
    progress
  )
  values (
    p_organization_id,
    'shipment-booking',
    'shipment',
    p_entity_id,
    'QUEUED',
    p_user_id,
    coalesce(p_progress, '{}'::jsonb)
  )
  on conflict (organization_id, entity_id)
    where job_type = 'shipment-booking'
      and entity_type = 'shipment'
      and entity_id is not null
      and status in ('PENDING', 'QUEUED', 'RUNNING', 'RETRYING')
  do nothing
  returning * into v_inserted;

  if v_inserted.id is not null then
    return v_inserted;
  end if;

  select *
    into v_existing
    from public.background_jobs
   where organization_id = p_organization_id
     and job_type = 'shipment-booking'
     and entity_type = 'shipment'
     and entity_id = p_entity_id
     and status in ('PENDING', 'QUEUED', 'RUNNING', 'RETRYING')
   order by created_at asc
   limit 1;

  if not found then
    raise exception 'Could not enqueue shipment booking job.';
  end if;
  return v_existing;
end;
$$;

revoke all on function public.enqueue_shipment_booking_job(uuid, uuid, uuid, jsonb) from public;
revoke all on function public.enqueue_shipment_booking_job(uuid, uuid, uuid, jsonb) from anon;
grant execute on function public.enqueue_shipment_booking_job(uuid, uuid, uuid, jsonb) to authenticated, service_role;

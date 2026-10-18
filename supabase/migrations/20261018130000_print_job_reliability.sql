-- Print job reliability: uncertain outcomes, device-bound routing, manual idempotency.
-- Additive. Does not rewrite existing job rows. Do not apply to production without approval.

alter table public.print_jobs
  drop constraint if exists print_jobs_status_chk;

alter table public.print_jobs
  add constraint print_jobs_status_chk
  check (status in ('PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'NEEDS_REVIEW'));

alter table public.print_jobs
  add column if not exists device_id uuid references public.print_devices(id) on delete set null;

alter table public.print_jobs
  add column if not exists claimed_by_device_id uuid references public.print_devices(id) on delete set null;

alter table public.print_jobs
  add column if not exists claim_id uuid;

alter table public.print_jobs
  add column if not exists idempotency_key text;

alter table public.print_jobs
  add column if not exists reprinted_from_job_id uuid references public.print_jobs(id) on delete set null;

create index if not exists print_jobs_org_device_status_idx
  on public.print_jobs (organization_id, device_id, status, created_at);

create unique index if not exists print_jobs_org_idempotency_uidx
  on public.print_jobs (organization_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.print_jobs.status is
  'PENDING queued; PRINTING claimed; PRINTED sent to the OS spooler (not physical proof); FAILED; NEEDS_REVIEW uncertain after a stale claim — do not auto-reprint.';

comment on column public.print_jobs.device_id is
  'Paired Print Agent that must claim this job. Null is legacy Node agent or WebUSB.';

alter table public.print_settings
  add column if not exists selected_device_id uuid references public.print_devices(id) on delete set null;

comment on column public.print_settings.selected_device_id is
  'Windows Print Agent station that should receive new agent print jobs.';

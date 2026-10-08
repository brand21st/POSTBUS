-- Isolated staging schema for India Post lock / job uniqueness validation.
-- Not production. No merchant data.

do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

do $$ begin
  create type public.job_status as enum ('PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.integration_status as enum ('NOT_CONNECTED','PENDING','CONNECTED','ERROR','DISCONNECTED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.shipment_status as enum (
    'DRAFT','VALIDATING','QUEUED','BOOKING','RECOVERY_REQUIRED','BOOKED','LABEL_PENDING','LABEL_READY',
    'MANIFEST_PENDING','MANIFEST_READY','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED',
    'FAILED','CANCELLED','RTO','NDR'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'staging-org'
);

create table if not exists public.india_post_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  status public.integration_status not null default 'CONNECTED'
);

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_type text not null,
  entity_type text,
  entity_id uuid,
  status public.job_status not null default 'PENDING',
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz,
  locked_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  last_error_code text,
  progress jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  status public.shipment_status not null default 'QUEUED',
  barcode text,
  booked_at timestamptz,
  last_error text,
  last_error_code text
);

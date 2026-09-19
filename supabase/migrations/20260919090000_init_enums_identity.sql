create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

do $$ begin
  create type public.member_role as enum ('OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_source as enum ('SHOPIFY', 'MANUAL', 'API', 'WOOCOMMERCE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.payment_status as enum ('PENDING', 'PAID', 'PARTIAL', 'COD', 'REFUNDED', 'FAILED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.fulfillment_status as enum ('UNFULFILLED', 'PARTIAL', 'FULFILLED', 'CANCELLED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.order_status as enum ('IMPORTED', 'READY', 'PROCESSING', 'BOOKED', 'SHIPPED', 'DELIVERED', 'FAILED', 'CANCELLED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.shipment_status as enum (
    'DRAFT','VALIDATING','QUEUED','BOOKING','BOOKED','LABEL_PENDING','LABEL_READY',
    'MANIFEST_PENDING','MANIFEST_READY','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED',
    'FAILED','CANCELLED','RTO'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.job_status as enum ('PENDING','QUEUED','RUNNING','RETRYING','SUCCEEDED','FAILED','CANCELLED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.integration_status as enum ('NOT_CONNECTED','PENDING','CONNECTED','ERROR','DISCONNECTED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.provider_env as enum ('UAT','PRODUCTION');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.label_status as enum ('PENDING','READY','FAILED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.api_key_status as enum ('ACTIVE','REVOKED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.billing_plan_code as enum ('STARTER','GROWTH','PRO','BUSINESS','ENTERPRISE');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.subscription_status as enum ('INCOMPLETE','ACTIVE','PAST_DUE','CANCELLED','UNPAID','CONFIGURATION_REQUIRED');
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  active_organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  drop constraint if exists profiles_active_organization_id_fkey;
alter table public.profiles
  add constraint profiles_active_organization_id_fkey
  foreign key (active_organization_id) references public.organizations(id) on delete set null;

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'VIEWER',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.member_role not null default 'OPERATOR',
  token_hash text not null,
  invited_by uuid references auth.users(id),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

drop trigger if exists set_members_updated_at on public.organization_members;
create trigger set_members_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();

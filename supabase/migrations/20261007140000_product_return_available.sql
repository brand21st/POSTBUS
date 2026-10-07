-- Product-level return flag for storefront checkout. Org-level returns policy stays in organization_policies.

alter table public.products
  add column if not exists return_available boolean not null default true;

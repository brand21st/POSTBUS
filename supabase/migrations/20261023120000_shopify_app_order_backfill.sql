-- Marks the one-time order import that runs the first time a merchant opens the Shopify app.

alter table public.shopify_app_installations
  add column if not exists backfill_started_at timestamptz;

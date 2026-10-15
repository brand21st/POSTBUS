-- AI Cover Studio: extend storefront slides, image jobs, events, and brand kit.

alter table public.platform_settings
  add column if not exists ai_cover_credit_cost integer not null default 10;

alter table public.platform_settings
  drop constraint if exists platform_settings_ai_cover_credit_cost;
alter table public.platform_settings
  add constraint platform_settings_ai_cover_credit_cost
    check (ai_cover_credit_cost >= 1 and ai_cover_credit_cost <= 500);

comment on column public.platform_settings.ai_cover_credit_cost is
  'AI credits charged per cover variation.';

alter table public.storefront_settings
  add column if not exists brand_kit jsonb not null default '{}'::jsonb;
alter table public.storefront_settings
  add column if not exists cover_autoplay boolean not null default false;

alter table public.storefront_slides
  add column if not exists name text,
  add column if not exists mobile_image_path text,
  add column if not exists cover_type text not null default 'homepage_hero',
  add column if not exists status text not null default 'PUBLISHED',
  add column if not exists hook text,
  add column if not exists description text,
  add column if not exists offer_badge text,
  add column if not exists discount_percent integer,
  add column if not exists text_position text not null default 'left',
  add column if not exists overlay_strength integer not null default 40,
  add column if not exists text_color text not null default '#ffffff',
  add column if not exists desktop_focal jsonb not null default '{"x":50,"y":50}'::jsonb,
  add column if not exists mobile_focal jsonb not null default '{"x":50,"y":50}'::jsonb,
  add column if not exists image_meta jsonb not null default '{}'::jsonb,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists source_asset_id uuid,
  add column if not exists ai_asset_id uuid,
  add column if not exists festival text,
  add column if not exists preset text;

update public.storefront_slides
set status = 'PUBLISHED'
where status is null or status = '';

alter table public.storefront_slides
  drop constraint if exists storefront_slides_cover_type_chk;
alter table public.storefront_slides
  add constraint storefront_slides_cover_type_chk
    check (cover_type in (
      'homepage_hero',
      'promotional',
      'collection',
      'product_launch',
      'festival_offer',
      'brand_campaign',
      'mobile_hero',
      'custom'
    ));

alter table public.storefront_slides
  drop constraint if exists storefront_slides_status_chk;
alter table public.storefront_slides
  add constraint storefront_slides_status_chk
    check (status in ('DRAFT', 'PUBLISHED', 'ARCHIVED'));

alter table public.storefront_slides
  drop constraint if exists storefront_slides_text_position_chk;
alter table public.storefront_slides
  add constraint storefront_slides_text_position_chk
    check (text_position in ('left', 'center', 'right'));

alter table public.storefront_slides
  drop constraint if exists storefront_slides_overlay_chk;
alter table public.storefront_slides
  add constraint storefront_slides_overlay_chk
    check (overlay_strength >= 0 and overlay_strength <= 80);

alter table public.storefront_slides
  drop constraint if exists storefront_slides_discount_chk;
alter table public.storefront_slides
  add constraint storefront_slides_discount_chk
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 90));

alter table public.storefront_slides
  drop constraint if exists storefront_slides_text_color_chk;
alter table public.storefront_slides
  add constraint storefront_slides_text_color_chk
    check (text_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.storefront_slides
  drop constraint if exists storefront_slides_window_chk;
alter table public.storefront_slides
  add constraint storefront_slides_window_chk
    check (ends_at is null or starts_at is null or ends_at > starts_at);

alter table public.storefront_slides
  drop constraint if exists storefront_slides_source_asset_fk;
alter table public.storefront_slides
  add constraint storefront_slides_source_asset_fk
    foreign key (source_asset_id) references public.ai_image_assets(id) on delete set null;

alter table public.storefront_slides
  drop constraint if exists storefront_slides_ai_asset_fk;
alter table public.storefront_slides
  add constraint storefront_slides_ai_asset_fk
    foreign key (ai_asset_id) references public.ai_image_assets(id) on delete set null;

create index if not exists storefront_slides_org_status_sort_idx
  on public.storefront_slides (organization_id, status, sort_order);

create index if not exists storefront_slides_org_window_idx
  on public.storefront_slides (organization_id, starts_at, ends_at)
  where status = 'PUBLISHED';

alter table public.ai_image_jobs
  add column if not exists purpose text not null default 'product';
alter table public.ai_image_jobs
  add column if not exists cover_type text;
alter table public.ai_image_jobs
  add column if not exists brief jsonb not null default '{}'::jsonb;

alter table public.ai_image_jobs
  drop constraint if exists ai_image_jobs_purpose_chk;
alter table public.ai_image_jobs
  add constraint ai_image_jobs_purpose_chk
    check (purpose in ('product', 'cover'));

alter table public.storefront_events
  add column if not exists slide_id uuid;
alter table public.storefront_events
  add column if not exists device text;

alter table public.storefront_events
  drop constraint if exists storefront_events_slide_fk;
alter table public.storefront_events
  add constraint storefront_events_slide_fk
    foreign key (slide_id) references public.storefront_slides(id) on delete set null;

alter table public.storefront_events
  drop constraint if exists storefront_events_type_chk;
alter table public.storefront_events
  add constraint storefront_events_type_chk
    check (event_type in (
      'PRODUCT_VIEW',
      'PRODUCT_CLICK',
      'ADD_TO_CART',
      'CART_OPENED',
      'CHECKOUT_STARTED',
      'PURCHASE',
      'COVER_IMPRESSION',
      'COVER_CLICK'
    ));

alter table public.storefront_events
  drop constraint if exists storefront_events_device_chk;
alter table public.storefront_events
  add constraint storefront_events_device_chk
    check (device is null or device in ('desktop', 'mobile', 'unknown'));

create index if not exists storefront_events_slide_idx
  on public.storefront_events (organization_id, slide_id, event_type, created_at desc);

-- Catalog Multi print as a Pro+ plan feature (independent of custom packing labels).

update public.plans
set features = features || '["Multi print"]'::jsonb
where slug in ('pro', 'business')
  and not coalesce(features, '[]'::jsonb) @> '["Multi print"]'::jsonb;

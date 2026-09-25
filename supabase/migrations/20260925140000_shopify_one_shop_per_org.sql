-- One PostBus workspace owns one Shopify shop, and one shop maps to one workspace.
-- The API loads connections with maybeSingle(), and webhooks look up by shop_domain.

create unique index if not exists shopify_connections_one_per_org
  on public.shopify_connections (organization_id);

create unique index if not exists shopify_connections_one_per_shop
  on public.shopify_connections (lower(shop_domain));

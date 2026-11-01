-- Realtime postgres_changes filters on organization_id require that column in
-- replica identity. Default identity is PK-only, which logs
-- "invalid column for filter organization_id".

alter table public.orders replica identity full;
alter table public.shipments replica identity full;
alter table public.notifications replica identity full;
alter table public.india_post_connections replica identity full;
alter table public.india_post_contracts replica identity full;
alter table public.support_conversations replica identity full;
alter table public.support_messages replica identity full;
alter table public.support_tickets replica identity full;

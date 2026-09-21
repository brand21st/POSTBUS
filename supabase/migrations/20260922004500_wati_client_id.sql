alter table public.wati_connections
  add column if not exists client_id text;

comment on column public.wati_connections.client_id is
  'Optional Wati workspace / client ID from the API Docs endpoint. V3 requests do not put this in the path.';

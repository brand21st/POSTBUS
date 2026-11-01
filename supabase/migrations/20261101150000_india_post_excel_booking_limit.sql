-- Rows per India Post bulk Excel file, set per workspace.
-- Approach Document: file booking takes up to 5000 articles. Null means the 5000 default.

alter table public.india_post_connections
  add column if not exists excel_booking_limit integer;

alter table public.india_post_connections
  drop constraint if exists india_post_connections_excel_booking_limit_check;

alter table public.india_post_connections
  add constraint india_post_connections_excel_booking_limit_check
  check (excel_booking_limit is null or (excel_booking_limit between 1 and 5000));

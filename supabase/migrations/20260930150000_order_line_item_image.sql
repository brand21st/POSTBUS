alter table public.order_line_items
  add column if not exists image_url text;

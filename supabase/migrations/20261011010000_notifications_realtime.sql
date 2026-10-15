-- Dashboard new-order popup/sound listens to postgres_changes on notifications.
-- Without this publication the UI only learns about new rows on the poll interval.

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

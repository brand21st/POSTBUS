-- Staging-first grant review. Do not apply to production until approved.
-- Queue/bind/identity tables stay service_role-only.
-- Merchant tables keep authenticated grants; revoke leftover anon table privileges.

revoke all on table public.support_ticket_counters from anon;
revoke all on table public.support_channels from anon;
revoke all on table public.support_conversations from anon;
revoke all on table public.support_tickets from anon;
revoke all on table public.support_messages from anon;
revoke all on table public.support_message_attachments from anon;
revoke all on table public.support_ticket_events from anon;
revoke all on table public.support_ticket_notes from anon;
revoke all on table public.support_workflows from anon;
revoke all on table public.support_notification_prefs from anon;
revoke all on table public.support_global_binds from anon;
revoke all on table public.support_unassigned_threads from anon;
revoke all on table public.support_unassigned_messages from anon;
revoke all on table public.support_identity_resolutions from anon;

-- Trigger and default-printer functions are not public API.
revoke all on function public.print_settings_clear_usb_default() from public, anon;
revoke all on function public.set_default_printer(uuid) from public, anon;
grant execute on function public.print_settings_clear_usb_default() to authenticated, service_role;
grant execute on function public.set_default_printer(uuid) to authenticated, service_role;

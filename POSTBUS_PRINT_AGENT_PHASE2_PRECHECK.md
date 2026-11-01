# PostBus Print Agent — Phase 2 precheck

Date: 15 October 2026

## Existing architecture

Phase 1 desktop app is `print-agent-desktop/` (Tauri 2, Rust, React). It lists Windows printers, prints a local test PDF through the printer device context, and hides to the tray. Settings live in app-data `settings.json`. No network calls existed before Phase 2.

The production print path is unchanged:

- `print_agents.organization_id` is UNIQUE. One legacy Node agent per organization.
- `print-agent/index.mjs` authenticates with `pb_print_` bearer tokens stored as `token_hash`.
- Routes `print-agent/heartbeat`, `print-agent/jobs/claim`, and `print-jobs/:id` still belong to that agent.
- `automation_settings.auto_label_printing` and `print_jobs` statuses were not changed.

PostBus APIs use `/api/v1`, the `{ success, data, message }` envelope, tenant permissions, and an in-memory `rateLimit` helper. Organization role checks go through `requireTenant`. Service-role access stays on the server.

## Database identity

The connected Supabase project is `https://hgacoeoovjxkzfbesmvl.supabase.co`.

That host is the live PostBus database. `list_branches` returned no development branches. There is no verified isolated staging project in this session.

The Phase 2 migration file is in the repository and was not applied.

## Files that Phase 2 changes

- `modules/print/device-pairing.ts` and its test: protocol state machine.
- `modules/print/device-pairing-db.ts`: server adapter. It does not read or write `print_jobs` or `print_agents`.
- `lib/api/v1/print-devices.ts` and `lib/api/v1/handle.ts`: new routes, registered before the tenant session when the caller is the desktop app.
- `lib/api/v1-permissions.ts`: merchant approve and revoke require `automation.manage`.
- `supabase/migrations/20261015120000_print_device_pairing.sql`: new tables only.
- `app/dashboard/settings/page.tsx` and `components/dashboard/print-agent-devices.tsx`: Settings → Printing.
- `print-agent-desktop/`: pairing UI, HTTPS client, Windows Credential Manager.

## Compatibility

The unique legacy agent constraint stays. A Windows device is a row in `print_devices`, not a second `print_agents` row. Registering a Windows computer does not rotate the Node token and does not claim print jobs.

## Security implications

The desktop app sends a device-bound verifier and later a device token. It does not receive a service-role key, a merchant password, or India Post, Shopify, or Razorpay credentials. Organization id is taken from the approved challenge on the server, not from the agent.

## Staging requirement

Apply `20261015120000_print_device_pairing.sql` only after a staging project or Supabase branch is identified and shown not to be `hgacoeoovjxkzfbesmvl`. Until then the new API returns “Device pairing is not enabled on this server.”

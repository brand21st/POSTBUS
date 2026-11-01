# PostBus Print Agent — Phase 2 database

Migration file: `supabase/migrations/20261015120000_print_device_pairing.sql`

Status: written, not applied. The connected database `hgacoeoovjxkzfbesmvl` is production and has no Supabase branch.

## New tables

- `print_devices` — one row per Windows computer, many per organization, `active` or `revoked`.
- `print_pairing_challenges` — code hash, verifier hash, expiry, approval, one-time consumed status. A unique index allows only one open challenge per code hash.
- `print_device_sessions` — access and refresh hashes and expiries. Raw tokens are not columns.
- `print_device_events` — pairing, refresh, and revoke events. Heartbeats update `last_seen_at` and do not insert an event.

## Unchanged

`print_agents` keeps `UNIQUE (organization_id)`. `print_jobs`, `print_settings`, `printers`, and `automation_settings` are not altered.

## RLS

`print_devices` and `print_device_events` allow member select through `is_org_member`. Challenges and sessions have RLS on and no policies for `anon` or `authenticated`. Server routes use the service role after checking the device token or the merchant session.

## Rollback

Drop the four new tables. No backfill and no change to legacy agent rows.

# PostBus Print Agent — Phase 2 release report

Date: 15 October 2026

## Result

Phase 2 code is in the development tree. It is not released to production.

The connected Supabase project is `https://hgacoeoovjxkzfbesmvl.supabase.co`. There are no development branches. The pairing migration was applied there on 15 October 2026 as schema migration `print_device_pairing` (version `20261015023750`). It was not rolled back. The Next.js app and the Windows agent were not deployed. Print jobs, the Node agent, India Post, Shopify, and billing were not modified.

## Installer

Built with `npm run tauri build` after the pairing changes. See the build log for the final path:

`print-agent-desktop/src-tauri/target/release/bundle/nsis/PostBus Print Agent_0.2.0_x64-setup.exe`

The installer is unsigned.

## Production blockers

1. No verified staging database. Integration tests have not run against Postgres.
2. The pairing tables already exist on production. Do not apply `20261015120000_print_device_pairing.sql` again.
3. `https://postbus.in` does not serve the new pairing routes until a later, separate application deploy. That deploy has not been done.
4. Concurrent redemption has not been proven on Postgres.
5. A production application deploy would start using the pairing tables that are already on `hgacoeoovjxkzfbesmvl`. Do that only after staging tests pass.

## Known limitations

- Heartbeats are not written to `print_device_events`, so a dashboard refresh does not insert a row. Online status is `last_seen_at` within 90 seconds.
- Rate limits are in memory on one Node process.
- The agent does not print PostBus labels.
- Local disconnect calls the server and then deletes the Windows credential. If the server is unreachable, the local credential is still removed.

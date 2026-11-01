# PostBus Print Agent — implementation plan

Phase 1 is implemented in `print-agent-desktop/`. Later phases, including pairing and database changes, stay unstarted. See `POSTBUS_PRINT_AGENT_PHASE1.md`.

## Phases

| Phase | Work | Exit |
| --- | --- | --- |
| 0 | This audit | Approved |
| 1 | Tauri 2 scaffold, Windows-only, tray shell, no cloud calls | EXE launches on Windows 10/11 |
| 2 | `EnumPrinters` module and a local printer list | Names match Windows Settings |
| 3 | Print a local sample PDF through the driver at actual size | One thermal and one A4 printer in the lab |
| 4 | Pairing routes and challenge table migration (not applied to production) | Tests for expiry, replay, and revoke |
| 5 | Job status columns and `UNKNOWN` recovery | Stale `PRINTING` jobs with a spooler timestamp are not requeued |
| 6 | Agent poll/claim/download against staging | Paired agent prints a staging label |
| 7 | Settings → Printing next to the Automation card | Pair, revoke, printer, history |
| 8 | Orders: Direct Print when an agent is online; Browser Print always | One order |
| 9 | Bulk: jobs for the current selection only | 50 selected orders, progress counts |
| 10 | Credential Manager, crash recovery, rate limits | Security tests |
| 11 | Tauri bundler EXE, version, update feed design | Unsigned build labeled unsigned |
| 12 | Staging on a packing PC | Hardware checklist signed |
| 13 | Production approval | Separate Coolify deploy after sign-off |

## Effort

One engineer who knows this repo: about 8 to 12 weeks including hardware passes. Pairing, the installer, and spooler-honest job states are the long parts. Printer discovery and PDF handoff are shorter because `print-agent/index.mjs` already proves them.

## Approvals required before build

1. Product: Direct Print is manual; Auto Label Printing stays a separate switch.
2. Security: device-code pairing replaces pasted tokens for the EXE; the CLI token remains until the EXE is default.
3. Data: additive migration only, applied to staging first.
4. Release: no Coolify deploy of the Next.js changes until staging hardware sign-off.
5. Legal: publisher name on the installer.

## Rollback

Leave the Node agent and WebUSB path in place. Feature-flag Direct Print with `print_settings.direct_print_enabled`. If the EXE misbehaves, merchants turn it off and use Browser Print.

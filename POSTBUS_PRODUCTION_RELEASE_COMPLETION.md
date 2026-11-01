# PostBus production release completion

Date: 2026-10-31  
**PRODUCTION DEPLOYMENT: NO-GO**

No production migration, Coolify deploy, git commit, or git push.

## 1. Blockers resolved

- Historical NULL booking dead-end: **code path added** (`ensureLegacyAddressValidation` before the booking gate).
- Duplicate local migration versions renamed so `supabase start` can apply locally.
- TypeScript after the booking change: **PASS** (`tsc -p tsconfig.build.json`, exit 0).
- Local Docker `project_id` changed to `postbuslocal` (Kong DNS). **Did not stop the WSL crash-loop.**

## 2. Bugs fixed

- Booking of valid stored legacy NULL addresses no longer hard-stops without classification.
- Invalid legacy NULL still cannot call CEPT / allocate (tests).

## 3. Staging environment status

WSL Supabase **unstable** (crash-loop). Stopped. 55432 bootstrap PG still not Auth. Staging Next `:3001` up. **Port 3000 is not listening** at the end of this session; this agent did not issue a kill to PID 49940 and did not restart production `next dev`.

## 4. Auth/RLS

**NOT VERIFIED** (unstable GoTrue).

## 5. Shopify E2E

**NOT VERIFIED** (no Auth, no browser).

## 6. India Post E2E

Unit/idempotency **PASS** (36 tests this run). App/stub booking via UI **NOT VERIFIED**.

## 7. Historical order safety

See `POSTBUS_HISTORICAL_ORDER_SAFETY.md`. ~13,661 orders lack a posted shipment. On-demand classify; no production bulk READY.

## 8. Migration readiness

See `POSTBUS_MIGRATION_RECONCILIATION.md`. Production needs **only** `20261030143000`. Local renames must not be pushed.

## 9. Release changeset

**BLOCKED** — 858 dirty paths. See `POSTBUS_EXACT_RELEASE_MANIFEST.md`.

## 10. Backup/recovery

**NOT VERIFIED.** See `POSTBUS_PRODUCTION_ROLLBACK_PLAN.md`.

## 11. Build/test results (this session)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.build.json` | exit 0 |
| `npx vitest run` historical-classify + booking-idempotency | 36 passed |
| `npx eslint .` | not re-run |
| `npm run build:verify` | not re-run |

## 12. Remaining risks

WSL Docker Auth loop; no hosted staging; dirty git; unproven backup; 13k historical orders depend on on-demand classify quality.

## 13. Production GO/NO-GO

**NO-GO**

## 14. Exact approval required (when gates pass)

1. Isolated git SHA containing only the manifest files (not this tree).
2. Apply `20261030143000` on `hgacoeoovjxkzfbesmvl` after proven backup.
3. Coolify `mw9larpomkyonxzy1rk3h6jm` + matching workers.
4. Separate approval for any mutating production smoke tests.

This prompt is not that approval.

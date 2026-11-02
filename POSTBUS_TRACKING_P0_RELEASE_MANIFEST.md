# POSTBUS Tracking P0 — Release Manifest

| Item | Value |
|---|---|
| Production base SHA | `865d295d8401aa55a3b20c6a1f937ceda94d846a` |
| Branch | `fix/tracking-ingestion-p0` |
| Coolify app | `mw9larpomkyonxzy1rk3h6jm` |
| Target git branch | `support-center-release` |
| Rollback SHA | `865d295d8401aa55a3b20c6a1f937ceda94d846a` |
| Migrations | **none** |
| New mandatory secrets | **none** |
| Canary env (deploy default) | all empty / `SIDE_EFFECTS=off` |

## Included application files

- `modules/india-post/tracking-bulk.ts` (+ tests)
- `modules/india-post/tracking-ingest-page.ts` (+ tests)
- `modules/india-post/tracking-p0-canary.ts` (+ tests)
- `modules/india-post/tracking-sync-run.ts` (+ tests)
- `modules/india-post/tracking-sync.ts`
- `modules/india-post/provider.ts` (+ session tests)
- `modules/ndr-rto/service.ts`
- `workers/processor.ts`
- `lib/env.ts`, `lib/jobs/retry.ts`, `.env.example`, `.env.staging.example`

No bulk booking, support, billing, Razorpay, labels, webhook CIDRs, or WhatsApp templates.

## Isolate budget

Shared `{ remaining }` object per **canary job** (default 32). Canary runs **one page**. Legacy path does not isolate.

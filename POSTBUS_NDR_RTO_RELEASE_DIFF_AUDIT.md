# POSTBUS NDR/RTO — Release Diff Audit

Base: `67891d40ea8f7ad6c4f07890085c8dcefbfd4833`  
Head: `865d295d8401aa55a3b20c6a1f937ceda94d846a`  
Source reviewed: `40ed3fbffdefedd6dc403ff71d08c7a1d2da86c0` (38 files)

`git diff --check` against the staged isolation set: clean.

## `git diff --stat` (production vs isolated HEAD)

```
 .env.staging.example                        |   4 +
 app/dashboard/ndr-rto/page.tsx              |  15 +-
 lib/api/v1/ndr-rto.test.ts                  |   2 +
 modules/india-post/apply-tracking.test.ts   |  48 ++++++-
 modules/india-post/apply-tracking.ts        |  40 +++++-
 modules/india-post/event-mapper.test.ts     | 203 ++++++++++++++++++++++++++++
 modules/india-post/event-mapper.ts          | 110 ++++++++++++---
 modules/india-post/provider.session.test.ts |  60 ++++++++
 modules/india-post/tracking-effects.test.ts |  71 ++++++++++
 modules/india-post/tracking-effects.ts      |   2 +-
 modules/india-post/tracking-sync.test.ts    |  12 +-
 modules/india-post/webhook.ts               |   1 +
 modules/ndr-rto/db.test.ts                  |  26 ++++
 modules/ndr-rto/reconcile.test.ts           | 105 ++++++++++++++
 modules/ndr-rto/reconcile.ts                |  74 ++++++++++
 modules/ndr-rto/service.test.ts             |   6 +-
 modules/ndr-rto/service.ts                  |  28 ++--
 types/api.ts                                |   1 +
 18 files changed, 769 insertions(+), 39 deletions(-)
```

## File matrix

| File | Summary | Category | Include | Risk |
|---|---|---|---|---|
| `event-mapper.ts` | P0: `item_delivered` before NDR phrases; no bare `addressee`; `rts === true` only; bagged/bag_received/dispatch/OFD; hold/intimation not NDR; redirected unclassified | A | YES | Low |
| `apply-tracking.ts` | Skip missing timestamps; rts ternary; persist `operational_status`; delivered_at from event time | A/B | YES | Low |
| `webhook.ts` | Pass `rts` true/false/null into apply | B | YES | Low |
| `tracking-effects.ts` | Shopify in_transit only if `orderStatus === "IN_TRANSIT"` | C | YES | Low |
| `ndr-rto/service.ts` | `unclassifiedTracked` count, tenant-scoped | A | YES | Low |
| `types/api.ts` | `unclassifiedTracked` on `NdrSummary` only | A | YES | Low |
| `ndr-rto/page.tsx` | Unclassified card + copy | A | YES | Low |
| `ndr-rto/reconcile.ts` | Dry-run projector; apply throws; production host blocklist | B | YES | Low (cannot write) |
| Tests (8 files) | Mapper matrix, persist, Shopify, WhatsApp, tenant, 400 tracking, sync caps | D | YES | None |
| `.env.staging.example` | CIDR + tracking-sync names already in prod `lib/env.ts` | B | YES | None |
| `lib/env.ts` / `.env.example` bulk flags | Bulk booking | F | NO | Would advertise bulk |
| `workers/processor.ts` | Bulk processor | F | NO | High |
| `tsconfig.json` scripts exclude | tsc workaround | F | NO | Hides seed errors |
| `40ed3fb` markdown reports | Whole-tree narrative | E | NO | Misleading |

## Shared-file hunk notes

- `types/api.ts`: production `liveTracking` union (including `"cached"`) preserved. Only `unclassifiedTracked` added.
- `apply-tracking.ts`: cherry-pick duplicated `matchingBulkTrackingArticle`; second copy deleted before commit.
- Processor, cron, session persist, webhook allowlist, tracking-sync implementation: **unchanged vs production** (already on `67891d40`).

## Inspected for leakage

No secrets, PII, debug bypasses, migrations, automatic backfill, CEPT webhook enablement, Shopify mutations, or WhatsApp template additions.

## Classification of every included change

All 18 files: **REQUIRED** (A/B/C/D) except `.env.staging.example` which is a **SHARED DEPENDENCY** documentation-only exception.

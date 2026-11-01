# POSTBUS NDR/RTO FINAL QA REPORT

**Date:** 2026-10-10  
**Auditor:** independent pre-deployment verification (do not treat prior AI reports as proof)

## Repository state

| Item | Evidence |
| --- | --- |
| Branch | `india-post-true-bulk-candidate` |
| Baseline HEAD before this commit | `531c08834a86bf0d5dd0924020840cae48542e71` |
| Local commit | `40ed3fb` (`git rev-parse HEAD` after commit) |
| Remote | `origin` = `https://github.com/brand21st/POSTBUS.git` |
| Push | **Not performed** |
| Production Coolify app | PostBus `mw9larpomkyonxzy1rk3h6jm` |
| Coolify git branch | `support-center-release` |
| **Deployed SHA** | `67891d40ea8f7ad6c4f07890085c8dcefbfd4833` (**VERIFIED** read-only Coolify API, status `running:healthy`) |
| Alternate UUID file `.coolify-deploy-uuid.txt` | `t55onqyrqrqoghw5e6dbnl0m` — **not used**; live app UUID matches `mw9larpomkyonxzy1rk3h6jm` |

`POSTBUS_NDR_RTO_PRODUCTION_AUDIT.md` is **still not in the repository**.

## Evidence matrix

| ID | Original problem | File | Fix | Test | Status | Remaining risk |
| --- | --- | --- | --- | --- | --- | --- |
| NDR-001 | `addressee` before DELIVERED | `event-mapper.ts` | Bare addressee removed; `item_delivered` before NDR phrases | `event-mapper.test.ts` TEST A | GREEN | Official CEPT catalogue still missing |
| NDR-002 | `operational_status` only on classified apply | `apply-tracking.ts`, dashboard unclassified | Persist when classified; unclassified count; dry-run replay | `db.test.ts`, `apply-tracking.test.ts` | GREEN (new events) | Historical production nulls until approved reconcile |
| NDR-003 | Unmapped CEPT strings | mapper logistics phrases | Dispatch/bagged/bag received/OFD tests | event-mapper tests | GREEN | Redirect/hold stay unclassified by design |
| NDR-004 | Hold as NDR | mapper | Hold/intimation → null | TEST B | GREEN | — |
| RTO-001 | Webhook `rts` | `webhook.ts` | Pass through only if raw boolean present | webhook + apply tests | YELLOW | Sample payload has no `rts`; field unverified |
| RTO-002 | Return vs customer delivery | `planTrackingUpdate` | Return lane → `RTO_DELIVERED`, no order DELIVERED | apply-tracking + event-mapper | GREEN | — |
| TRK-001 | Sync failures | provider/session/processor | 401 permanent; paging; persist session | provider.session.test | YELLOW | Live CEPT not called |
| TRK-002 | Webhook | allowlist | Empty CIDR quarantined; **not enabled** | allowlist tests | GREEN | Do not set production CIDRs in this release |
| AUTO-001 | NDR WhatsApp gap | tracking-effects | No new NDR/RTO templates | tracking-effects.test | GREEN | Feature still not implemented (by design) |
| SHOP-001 | OFD after NDR → Shopify in_transit | `tracking-effects.ts` | Shopify in_transit only if `orderStatus === "IN_TRANSIT"` | tracking-effects.test | GREEN | WhatsApp in_transit on OFD still sent (preserved templates) |

## Tests (re-run this session)

```
Test Files  13 passed (13)
Tests  105 passed (105)
```

Vitest 4.1.11. PGlite for `ndr-rto/db.test.ts`. Production DB **not used**.

## TypeScript

- `npx tsc --noEmit` after excluding `scripts/**/*.mts`: **PASS** (exit 0).
- Failures before exclude: untracked `scripts/seed-test-org-*.mts` TS5097. Those files **are not in HEAD** (`git cat-file` reported missing). Not NDR code. Not executed by Coolify nixpacks app build of git tree.
- `tsconfig.json` now excludes `scripts/**/*.mts` (committed).

**Classification:** BASELINE EXCEPTION for untracked seeds; **PASS** for changed NDR/runtime code and for `tsc` after exclude.

## Production build

1. First `npm run build`: compiled, then failed TypeScript on untracked seeds.  
2. After tsconfig exclude, one Windows worker crash `3221226505` during “Collecting page data”.  
3. Retry: **PASS** — compiled, TypeScript finished, 91/91 static pages, `/dashboard/ndr-rto` listed.

Build read `.env.local` (compile only). No production writes performed by this auditor.

## Security / database

- No new migration. Existing `20260927140000_ndr_rto.sql`.
- Reconcile apply throws; not imported by cron/workers.
- `assertReconcileTargetIsolated` blocks `hgacoeoovjxkzfbesmvl`.
- Tenant: `GET ndr-rto` / sync org-scoped; cross-org sync test still PASS.
- Staged files: no `.env`, no `coolify.local.json`, no credentials.

## Production health (read-only GET)

`https://www.postbus.in/api/health` → HTTP 200  
`{"success":true,"data":{"api":"Healthy","database":"Healthy","redis":"Disabled","jobRunner":"database","jobs":"Warning","shopify":"Warning","indiaPost":"Warning"}}`

Historical counts (170 barcodes / 272 events / 0 operational_status) **not rechecked** (would require production SQL). Marked **UNVERIFIED as current**.

## Compatibility

Local commit is **4 commits + NDR work ahead of** production branch `support-center-release` (`aa3e06a` support, `ea223a0` bulk booking, `c945993` dual WhatsApp, `531c088` support isolation). **Do not deploy this branch wholesale** without reviewing those commits. Prefer cherry-pick `40ed3fb` onto `support-center-release` after explicit approval.

Rolling workers: old mapper vs new mapper during deploy can briefly disagree; schema compatible. Rollback of app does **not** undo projections written by new code.

## Remaining uncommitted (preserved)

Orders, billing, Razorpay, support copy, labels, data-table, commerce address PATCH, and other dirty/untracked files were **not** staged.

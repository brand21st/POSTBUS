# POSTBUS NDR/RTO TEST REPORT

**Executed:** 2026-10-10  
**Runner:** `npx vitest run` (Vitest 4.1.11)  
**Database:** in-process PGlite for `modules/ndr-rto/db.test.ts`; all other suites mocked  
**Production Supabase `hgacoeoovjxkzfbesmvl`:** not used

## Command

```
npx vitest run modules/india-post/event-mapper.test.ts modules/india-post/apply-tracking.test.ts modules/india-post/webhook.test.ts modules/india-post/webhook-process.test.ts modules/india-post/tracking-effects.test.ts modules/india-post/provider.session.test.ts modules/india-post/tracking-sync.test.ts modules/india-post/tracking-response.test.ts modules/ndr-rto/service.test.ts modules/ndr-rto/reconcile.test.ts modules/ndr-rto/db.test.ts lib/api/v1/ndr-rto.test.ts modules/tracking-pages/customer-track-view.test.ts
```

## Result

**Test Files  13 passed (13)**  
**Tests  105 passed (105)**  
**Failed: 0**

## Coverage vs required cases

| # | Case | Result |
| --- | --- | --- |
| 1 | Item Delivered(Addressee) → DELIVERED | PASS |
| 2 | Hold + Intimation Delivered not NDR | PASS |
| 3 | Explicit NDR reason | PASS |
| 4 | Unknown / Item Redirected unclassified | PASS |
| 5 | Item Dispatched | PASS |
| 6 | Item bagged | PASS |
| 7 | Bag Received | PASS |
| 8 | Taken out for delivery | PASS |
| 9 | Item Redirected not auto RTO | PASS |
| 10–12 | RTS true / false / missing | PASS |
| 13–14 | Return in transit / delivered to sender | PASS |
| 15–16 | NDR then customer delivery / return | PASS |
| 17 | Duplicate event attempt count | PASS |
| 18 | Older event after newer | PASS |
| 19–20 | Repeated sync / NDR count idempotency | PASS |
| 21 | Operational status persistence (PGlite) | PASS |
| 22 | Dashboard summary tenant counts + unclassified | PASS |
| 23 | Cross-org sync rejected | PASS |
| 24 | CEPT 401 permanent auth | PASS |
| 25 | Partial bulk 400 → empty, not classified | PASS |
| 26 | CEPT timeout AbortError | PASS |
| 27 | FAILED not in tracking poll set | PASS |
| 28 | Historical dry-run reconcile | PASS |
| 29–30 | Reconcile does not call side effects; apply throws; OFD-after-NDR no Shopify | PASS |

## Other checks

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | Pre-existing failures in unrelated `scripts/seed-test-org-*.mts` (TS5097). No errors in NDR/tracking files. |
| ESLint on changed files | Fixed `prefer-const` in `event-mapper.ts`. Pre-existing `react-hooks/set-state-in-effect` on `app/dashboard/ndr-rto/page.tsx` line 101 (not introduced as new logic). |
| Live CEPT / WhatsApp / Shopify / production DB | **NOT RUN** (forbidden) |
| Hosted staging | **NOT RUN** — STAGING NOT AVAILABLE |
| Browser E2E of dashboard | **NOT RUN** (authenticated merchant session required) |

Do not treat this report as production-ready evidence.

# POSTBUS NDR/RTO GO / NO-GO

## Ratings

| Gate | Rating | Notes |
| --- | --- | --- |
| P0 Fix | GREEN | Delivered(Addressee); addressee keyword removed; tests |
| NDR | GREEN | Explicit reason + phrases; hold not NDR |
| RTO | GREEN | rts true → RTO; return delivery distinct |
| Tracking pipeline | YELLOW | Code+mocks; live CEPT UNVERIFIED; health indiaPost Warning |
| Operational persistence | GREEN | Isolated tests; historical prod nulls unchanged |
| Database | GREEN | No new migration; prod not written |
| Dashboard | GREEN | Stored buckets + unclassified honesty; no browser E2E |
| Shopify | GREEN | OFD-after-NDR no fulfillment |
| WhatsApp | GREEN | No NDR/RTO templates; in_transit/delivered/delayed preserved |
| Security | GREEN | Org scope tests; reconcile blocked |
| Tests | GREEN | 105/105 re-run |
| TypeScript | BASELINE EXCEPTION then PASS | Untracked seeds; exclude committed; tsc 0 |
| Production build | GREEN | Retry PASS after worker crash |
| Coolify | GREEN | Live SHA verified |
| Worker compatibility | YELLOW | Same-SHA deploy required; rolling mapper mismatch brief |
| Rollback | YELLOW | App rollback OK; projections not undone |

## FINAL RELEASE GATE

**CONDITIONAL GO FOR RELEASE APPROVAL**

Conditions:

1. **Do not deploy `india-post-true-bulk-candidate` wholesale.** Cherry-pick or equivalent onto `support-center-release` unless those extra commits are intentionally released.
2. **Do not push** until the user asks.
3. **Do not** reconcile, enable webhook CIDRs, or call live CEPT/Shopify/WhatsApp as a test.
4. Local commit `40ed3fb` is the NDR/tracking slice only.

This is **not** permission to deploy.

## Required next approval

**Push + Coolify deploy authorization**, specifying whether to cherry-pick onto `support-center-release` or release the entire feature branch.

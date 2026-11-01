# POSTBUS NDR/RTO — Isolated Release Candidate

Date: 2026-10-10  
Worktree: `D:/POSTBUS-NDR-RTO-ISOLATED`  
Branch: `release/ndr-rto-isolated`  
**Not pushed. Not deployed.**

## 1. Verified production baseline

| Item | Value |
|---|---|
| Coolify application | `mw9larpomkyonxzy1rk3h6jm` (PostBus) |
| Status | `running:healthy` |
| Git repository | `brand21st/POSTBUS` |
| Coolify git branch | `support-center-release` |
| **Deployed SHA** | `67891d40ea8f7ad6c4f07890085c8dcefbfd4833` |
| FQDN includes | `https://www.postbus.in` |
| Build pack | nixpacks, Node 22, `npm run build`, `npm start` |
| `JOB_RUNNER` | `database` |
| Database | `NEXT_PUBLIC_SUPABASE_URL` project ref `hgacoeoovjxkzfbesmvl` |
| Auto-deploy | **disabled** (`settings.is_auto_deploy_enabled = false`) |
| Preview deploys | disabled |

Baseline matches the previously recorded production SHA. Release diffs were calculated against this SHA, not against an assumed older revision.

## 2. Isolation method

1. Local worktree from `67891d40` (did not reset or clean the development working tree).
2. Cherry-pick of `40ed3fb` used only as a **review source**, with conflicts resolved **toward production** for shared infrastructure (`workers/processor.ts`, `lib/env.ts`, `.env.example`, `tsconfig.json`).
3. Duplicate merge leftover (`matchingBulkTrackingArticle` / helpers) removed from `apply-tracking.ts`.
4. Four prior implementation markdown files from `40ed3fb` were **not** committed (they describe the whole-tree commit, not this isolation).

Source fix commit: `40ed3fbffdefedd6dc403ff71d08c7a1d2da86c0`  
Release commit: `865d295d8401aa55a3b20c6a1f937ceda94d846a`

## 3. Included changes (18 files)

Category A — NDR/RTO classification: `modules/india-post/event-mapper.ts`  
Category B — tracking persistence / ingest: `apply-tracking.ts`, `webhook.ts` (rts ternary), dashboard + summary  
Category C — Shopify gate: `tracking-effects.ts`  
Category D — tests listed in the test report  
Category E — excluded from this commit (replaced by isolation reports)  
Shared: `.env.staging.example` documents tracking-sync / webhook CIDR names already parsed in production `lib/env.ts`. No new production secrets.

## 4. Excluded from `40ed3fb` (20 files)

Already identical on production (no port needed): cron jobs route + tests, `provider.ts`, `session.ts` + tests, `tracking-sync.ts`, `tracking-response.ts` + tests, `webhook-allowlist.ts` + tests, `webhook-process.test.ts`, `webhook.test.ts`.

Refused as unrelated / unsafe:

| File | Reason |
|---|---|
| `lib/env.ts`, `.env.example` | `INDIA_POST_BULK_*` bulk-booking flags |
| `workers/processor.ts` | bulk-booking processor rewrite (~155 lines vs production) |
| `tsconfig.json` | exclude `scripts/**/*.mts` (tsc cosmetic, not NDR) |
| Four `POSTBUS_NDR_RTO_*.md` from `40ed3fb` | whole-tree release narrative |

Unrelated features confirmed absent from `67891d40..HEAD`: Support Center, billing, Razorpay, storefront, inventory, marketing, experimental bulk booking.

## 5. Dependency analysis

Production already contains tracking-sync paging, fail-closed webhook CIDRs, session persist, and `tracking-effects`. Isolated release **depends on that baseline** and only tightens classification, persistence, and side-effect gates.

No additional development-branch commits were imported.

## 6. Gates

| Gate | Result |
|---|---|
| Tests | 106 passed / 0 failed / 14 files (isolated worktree) |
| TypeScript | `npx tsc --noEmit` PASS (no scripts exclude; no seed `.mts` in this tree) |
| Production build | PASS on retry after local `node_modules` (junction blocked Turbopack) + placeholder public Supabase env for prerender |
| Schema | Production `shipments` already has `operational_status`, NDR/RTO columns; `tracking_events.classification`; RLS on |
| New migration | none |
| New Coolify secrets | none |
| Reconciliation | dry-run only; `applyReconcileWrites()` throws; not executed |

## 7. Safety

- Shopify: fulfillment only when `orderStatus === "IN_TRANSIT"` or delivered; NDR/RTO/OFD WhatsApp `in_transit` does not fulfill.
- WhatsApp: existing templates only (`in_transit`, `delivered`, `shipment_delayed`). No NDR/RTO templates.
- Tenant: summary/list/sync still filter `organization_id`. RLS not weakened.
- Webhooks: Coolify has no `INDIA_POST_WEBHOOK_ALLOWED_CIDRS`; empty remains quarantined.

## 8. Remaining risks

- Local Node 24 vs Coolify Node 22; Linux nixpacks build not run here.
- Live CEPT return-completion event strings beyond fixtures: UNVERIFIED.
- Rolling deploy: old mapper can still mis-tag `Item Delivered(Addressee)` until the new image is exclusive.
- Historical unclassified counts not re-queried (must stay a separate dry-run).

## 9. Final recommendation

**CONDITIONAL GO FOR RELEASE APPROVAL** — isolation is complete and locally committed. Push and Coolify deploy remain unauthorized until an explicit follow-up approval.

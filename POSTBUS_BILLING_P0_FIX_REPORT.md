# PostBus — Billing P0 Fix: Implementation & Release-Readiness Report

**Date:** 2026-11-01 (IST)
**Branch:** `fix/billing-p0-hardening` (worktree `D:/postbus-billing-p0`), based on `origin/release/booking-safety-on-a2169cd-20261031` @ `c0be1e1`
**State:** implemented and tested locally. **Nothing committed, pushed, deployed, or migrated. No production data changed. No Razorpay payment made.**
**Baseline document:** `POSTBUS_BILLING_P0_AUDIT_REPORT.md`

---

## 1. Verified root-cause findings (re-checked against code and data before fixing)

| Audit item | Re-verification | Result |
|---|---|---|
| Live baseline | `D:/postbus-smart-auto-retry-rc/tmp-coolify-deploy.py` pins the Coolify app to `c0be1e1` / `release/booking-safety-on-a2169cd-20261031` | **Confirmed.** Used as the base. |
| Vulnerable lines still deployable | New guard (§5) run on refs: `origin/main`, `a27c8e6`, `8a52c36`, and local-only `release/booking-safety-on-main-20261031` (`8e999b6`) are all **BLOCKED** (F-01, F-02, …) | **Confirmed.** `8e999b6` is a newly found vulnerable candidate branch. |
| F-06 retry ambiguity | The **previous RPC SQL** (`20261030153000`) run in PGlite on a PENDING + legacy FAILED row returns `ambiguous` | **Confirmed by execution** (regression test kept). |
| F-06 (additional) | `classifyPlatformRazorpayPayment` and `loadSubscriptionByOrderId` used `maybeSingle()` on payments-by-order. With two rows for one order this errors, so `payment.captured` was classified **UNMATCHED** and ignored | **New finding, fixed.** |
| Org with no subscription row | RPC CASE B returned `notFound` when an organization had no subscription row at all, so such a workspace could pay and never be activated (2 production orgs have no row) | **New finding, fixed.** |
| F-07 | `route.ts` returned `200 duplicate` for any repeated event id, even when the stored attempt had `failed` | **Confirmed, fixed.** |
| F-05 | `assertPlanFeature` derived features from the plan slug only | **Confirmed, fixed.** |
| F-08 | Resume turned `PAUSED`/`PAYMENT_FAILED` into `ACTIVE` with any historical capture | **Confirmed, fixed.** |
| F-09 cohort | Read-only production query: **49** rolling trials for orgs that joined before 2026-11-01 00:00 IST. 2 have admin overrides, 0 have a captured payment. **47** would be corrected. 1 rolling trial belongs to an org created after the cutoff and is correct. | **Confirmed.** |
| Duplicate orders | 53 orders, 1 with >1 rows (PENDING + FAILED). **0 orders with >1 purchase-intent rows**, so the new unique index can be created. | **Confirmed.** |
| Unpaid ACTIVE | `661ff3ca` still ACTIVE Business ₹3,500, no capture. `0fc1f89e` (₹1 test capture, period ended 10-25) is still ACTIVE. `69c03db9` is paid and valid. | **Confirmed.** |

**Activity on the deployed worktree:** a new untracked file `tmp-coolify-smart-auto-retry-flag.py` appeared in `D:/postbus-smart-auto-retry-rc` during this session. I did not create it. Someone else appears to be working or deploying from the live line right now, so coordinate before any deploy.

---

## 2. Implementation summary

### Phase 0: repository and deployment safety
- Fixes are built on the **live release line** (`c0be1e1`), not on the older working tree. The main checkout (`fix/auth-session-stability`, with large unrelated uncommitted work) is **untouched**.
- **Build identifier:** `next.config.ts` inlines `NEXT_PUBLIC_BUILD_SHA`. It comes from `SOURCE_COMMIT` (Coolify build arg, now declared in `Dockerfile`), `POSTBUS_BUILD_SHA`, `GIT_COMMIT_SHA`, or `git rev-parse HEAD`. It is exposed in `GET /api/health` → `data.build.{commit,shortCommit,builtAt}` and in an `x-postbus-build` response header on every route. `"unknown"` means the build is untraceable.
- **CI guard:** `scripts/ci/billing-guard.mjs`. It blocks plan/status writes in `startCheckout`, any ACTIVE in `resumeSubscription`, direct `plan_id` writes in `changePlan`, `authorized` acceptance or a missing RPC in `verifyCheckout`, missing intent-only resolution, a `payment.failed` handler that does not record an attempt, a webhook route without claim/signature, feature gating without the coverage check, billing mutations on dismiss, and a missing migration. `--ref <sha>` checks a commit before it is deployed. Also added the `npm run verify:billing` script and the `.github/workflows/billing-guard.yml` workflow.

### Phase 1: activation security (kept from `c0be1e1`, extended)
- Checkout creates only a PENDING `payments` intent (`payment_purpose='subscription'`). The plan is never written at checkout. Dismissal only shows a toast and refreshes server state.
- Verification checks: HMAC(order|payment), a fetch from Razorpay, status **`captured` only**, `payment.order_id` equals the checkout order, then the RPC checks organization, currency, amount, plan and cycle from the intent, with a single PENDING claim under `FOR UPDATE`.
- A new test confirms an `authorized` payment is refused and leaves the trial and intent unchanged.

### Phase 2: retry fix (F-06)
- New table `payment_attempts`: one row per Razorpay payment, unique on `razorpay_payment_id`, with a `purchase_id` link and source `webhook|verify|reconcile|legacy_backfill`.
- `payment.failed` now **records an attempt** and sets `failure_reason` on the PENDING intent. It no longer inserts a second `payments` row, and the intent status stays PENDING. A late failure can never downgrade a CAPTURED row or attempt.
- Purchase intents are **PENDING/CAPTURED/REFUNDED only** (`PURCHASE_INTENT_STATUSES`, applied in TypeScript and in the RPC). Legacy FAILED rows are history: copied into `payment_attempts` by the migration and never deleted.
- Classification and subscription lookups no longer use `maybeSingle()` on order-scoped payment rows.
- Partial unique index `payments_subscription_intent_order_uidx` (one intent per order). It is created only if the data allows it; otherwise the migration raises a notice.

### Phase 3: webhook retry and recovery (F-07)
- `claim_razorpay_webhook_event(event_id, lease_seconds)` returns `claimed | busy | complete | missing`. A failed or expired-lease event is reclaimed. A live lease cannot be stolen. Processed and ignored events are never reprocessed. Results are written only by the lease holder.
- The route keeps signature verification and event-id idempotency. A concurrent delivery gets `409`, so Razorpay retries. If the RPC is not deployed yet, the route falls back to the old behaviour.
- **Reconciliation** (`modules/billing/reconcile.ts`, run from `/api/cron/billing`) looks at PENDING subscription intents older than 15 minutes and younger than 30 days, re-checked hourly, up to 25 per run. It makes a **read-only** `GET /orders/{id}/payments` call to Razorpay. If there is exactly one captured payment, it activates through the **same RPC**. It records failed attempts. More than one capture goes to manual review. An authorized-only or unpaid order is never activated. It never creates refunds or charges, and it skips cleanly if the migration is missing.
- Fallback webhook id now hashes the whole signed body. Before, it used a body prefix that is the same for every event.

### Phase 4: entitlements (F-05)
- `modules/billing/access.ts` → `decideBillingAccess()` is the **single decision** used by booking quota (`usage.ts`), plan features (`entitlements.ts`), the session payload, resume, and the billing page. Access is **period-based**: a live trial, a paid period, or an admin grant (plan assigned or extended) are operational only until the period end. `PAYMENT_FAILED`, `PAUSED`, `CANCELLED`, `EXPIRED`, and ACTIVE without a period are never operational.
- `assertPlanFeature(…, { method })`: without coverage, every paid feature is refused with "Your trial or subscription has ended…". The exception is **GET reads of the merchant's own history** for invoices, manifests, tracking-page settings, and label templates. Analytics, automation, integrations, bulk tools, and every write stay blocked. Billing pages, receipts and account management are not plan-gated, so they are unaffected.
- India Post booking stays enforced by `checkQuota`, now through the same decision.

### Phase 5: Nov 1 policy (F-09)
- `trial-policy.ts`: joined **before 2026-11-01 00:00 IST** → legacy (no trial after Nov 1). Joined on or after → 7-day trial. The boundary is tested at `2026-10-31T18:29:59.999Z` and `18:30:00.000Z`.
- New signups need no code change: `create_organization_for_user` already creates a server-side 7-day trial, deduplicated by `trial_claims`.
- The 47 Oct 27–31 rolling trials are corrected by a **reviewed, reversible script** (§8, section C), not by code.

### Phase 6: status, resume, cron, renewal (F-04, F-08)
- Resume now only clears `cancel_at_period_end` inside a covered paid period. It refuses trials, support pauses, failed payments, ended periods, and Razorpay-recurring cancellations. It never changes status or the period.
- The billing sweep can expire ended **one-time ACTIVE** periods, behind `BILLING_EXPIRE_ONE_TIME_ACTIVE=true` (default **off**). Access already stops at period end in code, so enabling the flag is a data change that needs owner approval.
- **Renewal keeps paid time:** paying before the current paid period ends sets the new end to now + cycle + remaining paid time. Trial and admin-granted time are not carried over. The previous end and carried seconds are recorded in history metadata.
- The sweep stays idempotent (conditional updates). Reconciliation is idempotent through the RPC.

### Phase 7: billing UI (F-10)
- The server computes `display` in `GET /billing/subscription`: **"Free Trial — X days remaining"**, **"Active Subscription"** (only with a captured payment for the period), "Active — plan granted by PostBus", **"Payment Failed — Retry"**, "Paused by PostBus support", **"Subscription Expired — Upgrade Required"**, plus a checkout banner: **"Payment Pending"** (<30 min), **"Payment Not Completed"**, or "Payment Failed — Retry".
- Payment history shows a server-computed status per row: Paid / Payment pending / Not completed / Failed — not charged / Refunded.
- Plan cards: a trial shows **"Free trial"**, never "Current plan". "Current plan" appears only for covered plans. Cancel and Resume appear only for paid active subscriptions.
- Dismissing Checkout or a failed payment invalidates the billing queries, so the server's pending or failed state shows. No client-side state change happens.

---

## 3. Changed files

**Modified (30):** `Dockerfile`, `next.config.ts`, `package.json`, `types/api.ts`, `app/api/health/route.ts`, `app/api/cron/billing/route.ts`, `app/api/webhooks/razorpay/route.ts`, `app/api/v1/tracking-pages/route.ts`, `app/api/v1/tracking-pages/host-status/route.ts`, `app/dashboard/billing/page.tsx`, `components/billing/checkout-button.tsx`, `components/billing/plan-picker.tsx`, `lib/api/v1/billing.ts`, `lib/api/v1/handle.ts`, `lib/api/v1/session.ts`, `lib/hooks/use-plan-entitlements.ts`, `modules/addons/classify.ts`, `modules/billing/{cron,entitlements,purchase,subscriptions,trial-policy,usage,webhooks}.ts`, `modules/razorpay/client.ts`, `modules/tracking-pages/assert-plan.ts`, tests: `modules/ai-credits/webhooks.test.ts`, `modules/billing/{checkout-security,trial-policy,webhooks}.test.ts`.

**New (19):** `supabase/migrations/20261101100000_billing_p0_hardening.sql`, `supabase/remediation/{billing_p0_review,billing_p0_remediation,billing_p0_remediation_revert}.sql`, `modules/billing/{access,attempts,display,reconcile,webhook-lease}.ts`, `lib/build-info.ts`, `scripts/ci/billing-guard.mjs`, `scripts/billing/razorpay-pending-audit.mts`, `.github/workflows/billing-guard.yml`, tests: `modules/billing/billing-p0-hardening.test.ts`, `modules/billing/billing-p0-hardening.pg.test.ts`, `modules/billing/billing-p0-remediation.pg.test.ts`, `modules/billing/__fixtures__/billing-schema.ts`, `app/api/webhooks/razorpay/route.test.ts`, `scripts/ci/billing-guard.test.ts`.

Totals: 621 insertions and 176 deletions in modified files, plus about 2,600 new lines (mostly tests and SQL).

---

## 4. Database migration — `20261101100000_billing_p0_hardening.sql`

Idempotent, additive, service-role only:
1. `payment_attempts` table with indexes and a member-read RLS policy. Backfill copies legacy FAILED rows (1 in production).
2. Partial unique index `payments_subscription_intent_order_uidx`, created only when there are no duplicate intents (production: 0 duplicates, so it will be created).
3. `razorpay_webhook_events` gains `processing_lease`, `processing_until`, `attempts`, `last_attempt_at`. Adds `claim_razorpay_webhook_event()`.
4. `payments` gains `reconcile_checked_at` and `reconcile_attempts`, plus a partial index on pending subscription rows.
5. `create or replace` of `fulfill_captured_subscription_purchase`, same signature. Changes: intent-only ambiguity check, REFUNDED treated as consumed, creates the subscription row if missing, carries over paid days, records the captured attempt, and writes history metadata.

**Compatibility:** the new code runs against the old schema (claim and reconcile fall back or skip), and old code runs against the new schema (same RPC signature and response shape). **Order: apply the migration first, then deploy the code.**
**Conflict note:** the unmerged working tree has `20261017122000_affiliate_webhook_leases.sql` defining `claim_razorpay_webhook(text)`. The new function has a different name, so they do not clash, and both use the same column names (`processing_lease`, `processing_until`, added with `if not exists`).
**Validated:** PGlite (embedded Postgres) with a minimal schema, including re-applying it. **Not yet validated on a Supabase staging database.**

---

## 5. Security improvements

- No plan, status, or period change is possible from checkout start, dismissal, resume, or change-plan. Activation happens only through the RPC after a captured, signature-checked, order-bound, amount/currency/org/intent-matched payment.
- `authorized` is never treated as paid (verify and reconciliation).
- Cross-tenant use, replays, a different payment on a fulfilled order, and duplicate webhooks cannot grant access (TypeScript and SQL checks).
- Expired workspaces lose paid operational features server-side, not only in the UI.
- Webhook events cannot be lost after a transient failure, and parallel deliveries cannot double-process.
- Build provenance (`/api/health`, `x-postbus-build`) plus a guard that blocks deploying vulnerable commits.
- Logs and attempt rows store only payment/order ids, amounts, statuses and truncated error text. No card, contact, email, or secrets. The audit script prints no PII.

---

## 6. Test results

| Verification | Result | Evidence |
|---|---|---|
| Billing and related suites (`modules/billing`, `modules/razorpay`, `modules/addons`, `modules/ai-credits`, `app/api`, `lib/api`, `scripts/ci`) | **PASS** | 0 failures. Includes 41 checkout-security, 18 new TypeScript regression tests, 16 PGlite migration/RPC, 3 PGlite remediation, 2 webhook-route retry, 3 guard tests. |
| Real-SQL integration (PGlite) | **PASS** | The new RPC activates once after FAILED, FAILED, CAPTURED. The old RPC returns `ambiguous` on the same data. |
| Full repository suite | **PASS for this change** | 2,515 passed. Failures in the full parallel run are pre-existing or load-related: run in isolation on untouched `c0be1e1`, the same files fail (analytics, provider.search, shopify payment evidence, live tracking HTTP test). The one regression found (`ai-credits/webhooks.test.ts` fake lacked list reads) was fixed: 16/16. |
| TypeScript (`tsc -p tsconfig.json`) | **PASS** | exit 0 |
| TypeScript on test files (scratch config) | **PASS for new code** | One pre-existing error at `checkout-security.test.ts:305` (identical line in `c0be1e1`). |
| ESLint (all changed and new files) | **PASS** | exit 0 |
| Production build (`next build`) | **BLOCKED** | Drive D: is full (§6a). |
| Billing guard | **PASS** on branch. **BLOCKS** `c0be1e1`, `8a52c36`, `a27c8e6`, `origin/main`, `8e999b6`. | |
| Supabase staging migration | **NOT TESTED** | No staging DB: Docker/local Supabase is not installed. PGlite only. |
| Razorpay test-mode payment | **NOT TESTED** | Needs staging plus test keys. |
| Browser UI check of the billing page | **NOT TESTED** | The local dev server points at the production DB (`.env.local`). Not run, to avoid production reads and writes from a browser session. |
| RLS on `payment_attempts` | **NOT TESTED** | Policy mirrors `payments_tenant_select`. Needs a hosted DB. |

### Required regression coverage (Phase 9)

| # | Scenario | Result | Test |
|---|---|---|---|
| 1 | Checkout opened then closed | PASS | checkout-security 1–3, 20; guard `dismiss` |
| 2 | Checkout cancelled before payment | PASS | same, plus display "Payment Not Completed" |
| 3 | Payment failure | PASS | checkout-security 4–6; `payment.failed` attempt test |
| 4 | Captured payment verification | PASS | checkout-security 7; PGlite `granted` |
| 5 | Failed then successful retry | PASS | PGlite (new RPC) plus old-RPC regression |
| 6 | Multiple failures then success | PASS | PGlite FAILED, FAILED, CAPTURED; TypeScript webhook test |
| 7 | Duplicate webhook | PASS | checkout-security 13; PGlite duplicate; route test |
| 8 | Failed webhook then retry | PASS | `route.test.ts`; PGlite claim/lease |
| 9 | Browser closes after successful payment | PASS (unit) | reconciliation fulfills through the RPC; webhook retry |
| 10 | Stale pending reconciliation | PASS (mocked Razorpay) | reconcile tests |
| 11 | Replayed payment id | PASS | checkout-security 12; PGlite `forbidden` |
| 12 | Cross-tenant payment | PASS | checkout-security 11; PGlite `forbidden` |
| 13 | Concurrent verification | PASS (limited) | checkout-security 8b (mock); PGlite single-connection serialization |
| 14 | Trial expiration | PASS | access tests; cron tests |
| 15 | Expired merchant paid operations | PASS | `assertPlanFeature` tests; existing quota tests |
| 16 | Existing merchant Nov 1 cutoff | PASS | trial-policy boundary; remediation PGlite |
| 17 | New merchant Nov 1 registration | **NOT TESTED** | Boundary unit-tested; `create_organization_for_user` not executed |
| 18 | Resume without payment | PASS | new resume tests; checkout-security 16/16b |
| 19 | One-time period expiration | PASS | access `PERIOD_ENDED`; cron flag test |
| 20 | Paid customer early renewal | PASS | PGlite carry-over (≈40 days) |
| 21 | Admin plans and trial exceptions | PASS (partial) | admin-extended period stays operational; remediation skips overrides. `adminAssignPlan` itself is unchanged and not re-tested. |
| 22 | Authorized, uncaptured payment | PASS | new verify test; reconciliation `authorizedOnly` |
| 23 | Checkout UI shows accurate status | PASS (unit) / NOT TESTED (browser) | display tests |

### 6a. Production build — **BLOCKED**
- Attempt 1 (worktree `node_modules` junction to the main checkout): Turbopack refused the junction ("Symlink … points out of the filesystem root"). No compile result.
- Attempt 2 (`npm ci` inside the worktree): **drive D: ran out of space** (489 GB of 489 GB used). The install failed, so no build ran.
- Cleanup: I removed only my own artifacts (partial `node_modules`, `.next`, a 350 MB npx cache folder on C:). D: now has about 0.8 GB free and C: about 9 GB, which is not enough for a full install plus `.next`. I deleted nothing else.
- Coverage meanwhile: `tsc --noEmit` passes for the whole app (same compiler inputs as the build's type phase). ESLint passes. **A production `next build` still has to pass in CI (the new workflow runs on GitHub) or after disk space is freed.**
- Final local run: **58 test files, 310 tests passed** across billing, Razorpay, add-ons, AI credits, `app/api`, `lib/api`, and `scripts/ci`. Billing guard OK.

---

## 7. Remaining known risks

1. **Deployment control is still manual.** Coolify can be pointed at any SHA by the `tmp-coolify-*.py` scripts. The guard only helps if it is run (CI, or `--ref` before deploy). `release/booking-safety-on-main-20261031` (`8e999b6`) and `origin/main` must not be deployed.
2. **Unmerged lines.** The main working tree (`fix/auth-session-stability`) has unrelated features (affiliates, tax invoices, AI accountant changes) built on the vulnerable checkout code. Merging it into this branch needs conflict resolution in `modules/billing/*`. Re-run the guard after any merge.
3. **Feature lockout impact.** After deploy, the 127 expired orgs (and each trial as it ends) lose analytics, automation writes, integration writes and bulk tools. History stays readable. This is correct per policy, but it needs merchant communication.
4. **Background automation** (Shopify order import, tracking sync, WATI messages for existing shipments) is not billing-gated. New bookings are blocked, so nothing billable runs. Gating ingestion is a product decision.
5. **Reconciliation activates real customers.** Once deployed, it can activate subscriptions for PENDING orders that Razorpay shows as captured (the intended recovery). Run `scripts/billing/razorpay-pending-audit.mts` first to see who.
6. **Upgrade semantics.** Carry-over gives remaining paid days on the new plan, which is generous on upgrades. Proration is a business decision.
7. **Trial-claim dedupe.** Claims are written only when the profile has an email (existing SQL). A WhatsApp-only profile could claim repeatedly. Low risk, unchanged.
8. **Not verified:** staging migration on Supabase, Razorpay test mode, browser rendering, real Postgres multi-connection concurrency.

---

## 8. Production data impact

Read-only analysis. **No production DML executed.**

| Change | Rows | Trigger |
|---|---|---|
| Migration backfill → `payment_attempts` | 1 legacy FAILED row copied (source kept) | Applying the migration |
| Unique intent index | Created (0 conflicts) | Applying the migration |
| `661ff3ca` loses Business feature access | 1 | Code deploy (access decision). Booking was already blocked. |
| Expired orgs lose paid feature APIs (history readable) | 127 now, growing | Code deploy |
| Reconciliation may activate paid-but-unactivated orders | Unknown until the audit script runs (50 PENDING, 0 known captured) | Code deploy plus cron |
| `661ff3ca` → EXPIRED (remediation A) | 1 | **Owner approval** |
| Ended one-time ACTIVE → EXPIRED (B / cron flag) | `661ff3ca`, `0fc1f89e` | **Owner approval** |
| Oct 27–31 rolling trials end at Nov 1 00:00 IST (C) | 47 (excludes 2 admin overrides, 0 paid) | **Owner approval** (a grace date can be set) |
| Paid customer `69c03db9` | unaffected | — |

Scripts: `supabase/remediation/billing_p0_review.sql` (read-only preview), `billing_p0_remediation.sql` (transaction with no COMMIT, safety predicates re-checked at run time, full before/after rows logged in `billing_remediation_log` plus history rows, refuses a double apply), and `billing_p0_remediation_revert.sql` (restores only rows that are unchanged since remediation). All three were exercised in PGlite.

---

## 9. Production deployment checklist (do not start without approval)

1. Freeze other deploys. Confirm nobody is using `D:/postbus-smart-auto-retry-rc` deploy scripts.
2. Review the diff on `fix/billing-p0-hardening`. Commit, push, open a PR (CI runs `billing-guard`).
3. `node scripts/ci/billing-guard.mjs --ref <release-sha>` → OK.
4. Staging: apply all migrations to a Supabase staging project, then `20261101100000`. Run the Razorpay **test-mode** flows: dismiss, fail → retry → capture, close the browser after paying (reconcile), and a duplicate webhook delivery. Check the billing page in a browser.
5. Production backup / PITR mark. Run `billing_p0_review.sql` and save the output.
6. Apply `20261101100000_billing_p0_hardening.sql` to production (approval #1).
7. Run `npx tsx scripts/billing/razorpay-pending-audit.mts --env <prod env> --read-only`. Review any `PAID_NOT_ACTIVATED`.
8. Point Coolify at the release SHA with the `SOURCE_COMMIT` build arg (approval #2). Verify `GET /api/health` → `data.build.commit` equals the SHA, and the `x-postbus-build` header.
9. Smoke tests: billing page for a trial, an expired, and a paid account. Webhook health. `/api/cron/billing` output, including `reconciliation`.
10. Optional, separately approved: remediation script sections A/C (approval #3), `BILLING_EXPIRE_ONE_TIME_ACTIVE=true` (approval #4).
11. Merchant communication for the expired cohort and the Oct 27–31 cohort.

---

## 10. Rollback plan

- **Code:** point Coolify back to `c0be1e1`. The new migration is backward compatible with it (same RPC signature and response shape). Note that `c0be1e1` brings back F-02/F-05/F-06/F-07.
- **Migration:** additive. To restore the previous RPC, re-run `supabase/migrations/20261030153000_fulfill_expired_subscription_purchase.sql` (`create or replace`). The table, columns and indexes can stay. Drop `payments_subscription_intent_order_uidx` only if it blocks the old code (it will not: old code does not insert duplicate intents).
- **Data:** `billing_p0_remediation_revert.sql` (batch `billing_p0_20261101`). Set `BILLING_EXPIRE_ONE_TIME_ACTIVE` back to unset to stop status flips. Rows it already expired are listed in `subscription_history` (`reason='period_ended'`).

---

## 11. Operations requiring explicit owner approval

1. Commit, push, and open a PR for `fix/billing-p0-hardening`.
2. Apply migration `20261101100000_billing_p0_hardening.sql` to staging, then production.
3. Run the read-only Razorpay audit script against production (it uses the production Razorpay keys).
4. Deploy the release to production (Coolify SHA change).
5. Remediation section A (`661ff3ca` → EXPIRED).
6. Remediation section C (47 Oct 27–31 trials → Nov 1 end), or choose a grace date.
7. Remediation section B or `BILLING_EXPIRE_ONE_TIME_ACTIVE=true`.
8. Merchant communication about feature lockout after expiry.
9. Decide on product items: gating background order ingestion; upgrade proration.

---

## 12. Final recommendation

**NOT READY FOR PRODUCTION**, though the code is ready for staging.

The fixes are implemented and verified locally: unit tests, real-SQL PGlite tests, typecheck, lint, and the guard. The production build is **blocked by a full D: drive** and has not run. Production readiness still needs: (0) a passing `next build`, (1) the migration applied and verified on a Supabase staging database, (2) Razorpay test-mode runs of the dismiss / fail-retry / browser-closed / duplicate-webhook flows, (3) a browser check of the billing page, (4) a reviewed commit and PR with CI green, and (5) your approvals in §11. Until then, keep production on `c0be1e1` and do not deploy any branch the guard blocks.

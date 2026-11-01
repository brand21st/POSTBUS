# PostBus — P0 Billing System Audit Report

**Date:** 2026-11-01 (IST) · **Mode:** audit only. No code, config, data, migration, or subscription state was changed. No payments were made. No commits, no deploys.

**Evidence sources**
- Repository: working tree on `fix/auth-session-stability` (HEAD `8a52c36` plus uncommitted changes), and the Nov 1 release branch `origin/release/booking-safety-on-a2169cd-20261031` (`c0be1e1`), read from a `git archive` snapshot.
- Live site: read-only GET of `https://www.postbus.in/pricing` and its public JS chunks, to fingerprint which code is deployed.
- Production database: **read-only** PostgREST `SELECT`s using the credentials in `.env.local` (that file points at production). Only counts and non-personal columns were read. IDs below are shortened to 8 characters.
- Tests: the existing Vitest billing suites (mocked, plus PGlite) run against both code lines.

---

## A. Executive Summary

| Item | Verdict |
|---|---|
| Overall billing health | **Not safe for paid billing as deployed.** The current live payment path is sound, but deployment control is broken, a record activated without payment is still in production, and several paid-customer failure paths are open. |
| Severity | **P0** (deployment drift that can bring back the activation-without-payment bug at any time) |
| Reported bug | **Confirmed. It happened in production.** Subscription `661ff3ca` became `ACTIVE` on Business (₹3,500/month) with **zero captured payments** on 2026-10-30, 07:20–08:29 IST. |
| Root cause | **Backend, not frontend.** Code before 2026-10-30 (a) wrote the selected plan and amount onto the live subscription as soon as checkout started, and (b) let a merchant turn a trial into `ACTIVE` with Cancel then Resume. Closing the Checkout window did nothing by itself. The database was already changed before the window opened. |
| Can activation without payment happen now? | **Not on the code currently live** (release line). **Yes, if any older branch is deployed again.** `origin/main`, `origin/release/ai-accountant` and the other release branches still contain the vulnerable code, and the fix commit `8a52c36` is not pushed anywhere. |
| Can unpaid customers use paid features? | **India Post booking: no.** It is gated server-side for every entry point. **Other plan features: yes.** Feature checks ignore expiry, so 127 expired trials keep Business-plan API access to analytics, invoices, tracking pages, automation, integrations, label templates and bulk tools. |
| Immediate business risk | (1) Redeploying the wrong branch brings back free activation. (2) A customer whose first card attempt fails and who then pays in the same Checkout session is **charged but never activated**. (3) A webhook that fails once is never reprocessed. (4) About 48 merchants who joined Oct 27–31 are on free trials until Nov 3–7, which conflicts with the stated Nov 1 policy. |

---

## B. Current Billing Architecture

**Integration type:** **Razorpay Orders** (one-time payment per period, `payment_capture: 1`). The Razorpay Subscriptions code paths (`subscription.*` webhooks, `razorpay_subscription_id`) exist but are unused: production has **0** rows with `razorpay_subscription_id`.

### Two divergent code lines (critical context)

| Line | Where | Checkout start | Activation |
|---|---|---|---|
| **Old** | `a27c8e6`, `origin/main`, `origin/release/ai-accountant`, `origin/support-center-release`, all other pushed release branches before 10-30 | Writes the selected plan to the live subscription. Creates a full-period `TRIAL` row if none exists. | Trusts the subscription row |
| **Working tree** | `8a52c36` + uncommitted (this checkout, **not pushed**) | Plan stays on the `PENDING` payment row. Stamps `razorpay_order_id` on the subscription. | TS `applyCheckoutIntent` + `activateSubscription`. Accepts `authorized`. |
| **Release (live now)** | `96b3fc7` → `c0be1e1` on `origin/release/booking-safety-on-a2169cd-20261031` | Inserts only a `PENDING` payment (`payment_purpose='subscription'`) | Postgres RPC `fulfill_captured_subscription_purchase` (row locks, single claim) |

**Which line is live:** the live `/pricing` bundle contains the release-line `CheckoutButton` (`modal.ondismiss` → "Payment was not completed. Your current plan remains unchanged." and the `/do not pay again/i` handling). Those strings exist only from `96b3fc7` onward. Frontend and API ship in one Next.js build, so the live API is almost certainly the release line too. The server commit was **not directly verified**: there is no build SHA endpoint.

**Drift evidence:** a `checkout_started` history row at **2026-11-01 00:51 IST** (subscription `69c03db9`) has the working-tree signature: empty `metadata`, `to_plan_id` = intended plan, and `subscriptions.razorpay_order_id` set to that order. Release-line rows have `metadata.intendedPlanId` instead. So production ran a working-tree build at 00:51 IST and runs the release build now. `c0be1e1` was committed at 00:58 IST.

### Live (release line) data flow

```
Billing page (app/dashboard/billing/page.tsx)
  └─ PlanPicker → CheckoutButton (components/billing/checkout-button.tsx)
       POST /api/v1/billing/subscribe  (OWNER only: org.billing)
         └─ startCheckout (modules/billing/subscriptions.ts:214)
              createRazorpayOrder(payment_capture=1) → payments.insert PENDING (:259)
              history/audit "checkout_started" (metadata only, plan unchanged)
       Razorpay Checkout opens
         ├─ ondismiss → toast only (:84). No API call.
         ├─ payment.failed → toast only
         └─ handler → POST /api/v1/billing/verify
               verifyCheckout (:313): HMAC(order|payment) → fetch payment from Razorpay
               → status must be "captured" (:348) → payment.order_id must equal checkout order
               → fulfillCapturedSubscriptionPurchase → RPC fulfill_captured_subscription_purchase
                    (org match, currency, amount, single PENDING claim, FOR UPDATE, sets ACTIVE)
Razorpay webhook POST /api/webhooks/razorpay (route.ts)
   HMAC over the raw body → insert razorpay_webhook_events (unique event_id) → processRazorpayEvent
   payment.captured → same RPC.  payment.failed → inserts a FAILED payments row.
Cron /api/cron/billing → runBillingSweep (cron.ts): expires TRIAL / PAYMENT_FAILED / cancel-at-end rows past their period
Enforcement:
   Booking: checkQuota (usage.ts) in shipments/service.ts:154,601 and workers/processor.ts:417 (every booking job)
   Features: lockedFeatureForApi + assertPlanFeature (lib/api/v1/handle.ts:79 → entitlements.ts:220)
```

### Data model (production)

- `plans`: starter ₹499 / pro ₹1,499 / business ₹3,500 per month.
- `subscriptions`: one "live" row per org. Statuses: TRIAL, ACTIVE, PAST_DUE, PAUSED, PAYMENT_FAILED, EXPIRED, CANCELLED. Also `trial_cohort`, `trial_manual_override`, `pending_plan_id`.
- `payments`: purchase intent and payment record. PENDING / CAPTURED / FAILED / REFUNDED, plus `payment_purpose`. Unique on `razorpay_payment_id`. **No unique index on `razorpay_order_id`**, because of a known duplicate.
- `billing_usage`, `subscription_history`, `billing_audit_logs`, `razorpay_webhook_events`, `trial_claims`, `platform_settings` (trial_enabled=true, trial_days=7).

**State separation (release line):** Selected plan → `payments.plan_id` (PENDING). Payment initiated → PENDING row plus Razorpay order. Payment completed → RPC flips the row to CAPTURED. Active subscription → the same RPC transaction. These four states are now distinct. **In the old line they were not.**

### Super Admin

`lib/api/admin/handle.ts`: assign plan (`adminAssignPlan`: no payment, by design), extend trial (sets `trial_manual_override`), pause, account status. The revenue dashboard counts every `ACTIVE` row as revenue (`:187`) whether or not it was paid.

---

## C. Confirmed Findings

### F-01 · P0 · Plan written to the subscription at checkout start (old code). This is the reported bug.
- **Where:** `a27c8e6:modules/billing/subscriptions.ts:193–263` (`startCheckout`). Still present on `origin/main` and every pushed release branch dated before 2026-10-30.
- **Behaviour:** `checkoutPatch` (plan_id, billing_cycle, amount_paise, order_limit) is applied to the live subscription before payment (`:233`, `:263`). With no live row, it inserts `status: "TRIAL"` with a **full month/year** period (`:242–246`).
- **Effect:** the billing page reads the subscription, so after Checkout is closed it shows the chosen plan as current. A trial org that chose a bigger plan also got that plan's limits.
- **Production evidence:** 25 `checkout_started` history rows rewrite `from_plan_id → to_plan_id` (2026-09-24 → 2026-10-30), across 12 subscriptions. Example: `24508e83` switched plans 5 times on 10-30 (01:11–03:57 UTC) with only PENDING payments.
- **Fixed in:** release line `96b3fc7` and working tree `8a52c36`. Neither fix has reached `origin/main`.

### F-02 · P0 · Cancel → Resume turned an unpaid trial into ACTIVE (old code). Used in production.
- **Where:** `a27c8e6:modules/billing/subscriptions.ts:807–818` (`resumeSubscription`) set `status: "ACTIVE"` unconditionally.
- **Repro (old code):** on a trial, click Cancel, then Resume. The row becomes ACTIVE with no payment.
- **Production evidence, subscription `661ff3ca` (legacy cohort):**
  ```
  10-20 09:52  null  → TRIAL   trial_started
  10-30 01:50:32 TRIAL → TRIAL  cancel_at_period_end  (user)
  10-30 01:50:40 TRIAL → ACTIVE resumed               (user)
  10-30 01:50:48 ACTIVE→ACTIVE  checkout_started  business→pro       PENDING ₹1,499
  10-30 02:59:52 ACTIVE→ACTIVE  checkout_started  pro→business       PENDING ₹3,500
  ```
  No CAPTURED or FAILED payment exists for this org. Also `face355a`: `PAYMENT_FAILED → ACTIVE` via `resumed` on 2026-09-25.

### F-03 · P0 · Production is deployed from divergent, unmerged code lines
- **Evidence:** section B. The live bundle is the release line, the 00:51 IST history row is the working-tree line, and old code sits on `origin/main`. `8a52c36` exists only locally. The release line's hardening (purchase RPC, `checkout-security.test.ts`) is not in the working tree. The working tree's fixes (one-time ACTIVE expiry in cron, webhook lease/claim) are not in the release line.
- **Impact:** billing behaviour depends on whichever worktree was deployed last. Deploying `origin/main` or `origin/release/ai-accountant` brings back F-01 and F-02 immediately.

### F-04 · P1 · An unpaid ACTIVE subscription is still in production
- **Record:** `661ff3ca`: `ACTIVE`, Business, ₹3,500, `current_period_end = 2026-11-01 00:00 IST`, no captured payment.
- **Current effect (release code):** booking is **blocked**, because the period has ended and there is no Razorpay subscription, so `subscriptionCoverageEnded` returns true and `checkQuota` fails. The cron never expires it (`cron.ts:34` only expires TRIAL, PAYMENT_FAILED, or cancel-at-end rows). Business plan features stay unlocked (F-05). The admin revenue view counts it as ACTIVE revenue.

### F-05 · P1 · Feature entitlements ignore expiry (an authorization gap separate from the UI)
- **Where:** `modules/billing/entitlements.ts:197–217` (release). `features = expandPlanFeatures(plan.features, { slug })` regardless of `coverageEnded` or `status === "EXPIRED"`. `assertPlanFeature` (`:220`) checks only that list. The fallback loader also returns the newest non-live row.
- **Trigger:** any expired org. The trial migration set every unpaid org's `plan_id` to **business**, and there are 127 EXPIRED rows.
- **Effect:** server routes gated only by `lockedFeatureForApi` stay open after expiry: analytics, invoices and sales invoices, tracking pages, automation writes, Shopify/WooCommerce/WATI/India Post integration writes, label templates, bulk download/print, `bookings`. **India Post booking itself is enforced** by `checkQuota` (`usage.ts:123`) in all booking paths, including the worker.
- **Status:** confirmed by code. Not exercised at runtime.

### F-06 · P1 · Charged but not activated: a failed attempt followed by a successful retry in the same Checkout
- **Where:** `modules/billing/webhooks.ts:342–380` (release). `payment.failed` calls `upsertPayment`, which **inserts a second `payments` row** for the same `razorpay_order_id`. `payment_purpose` defaults to `'subscription'`. Then `purchase.ts:47` and RPC `…153000_fulfill_expired_subscription_purchase.sql:49` see 2 rows for the order and return **`ambiguous`**.
- **Repro:** Checkout → first card declined (Razorpay fires `payment.failed`) → retry in the same modal succeeds. `/verify` returns 409 "ambiguous". `payment.captured` is logged as `webhook_ambiguous_order` and ignored. The customer is charged and the plan is not activated.
- **Production evidence:** the mechanism has already fired. One order has more than one payment row: a 2026-09-24 `payment.failed` ("website does not match registered website") created a FAILED row next to the PENDING one. The RPC migration notes that this duplicate blocks the order-ID unique index.
- **Status:** confirmed by code and data. The end-to-end retry was not run.

### F-07 · P1 · A webhook that fails once is never reprocessed; no PENDING reconciliation
- **Where:** `app/api/webhooks/razorpay/route.ts:36–51` (release). The event row is inserted first. On a processing error it is marked `failed` and returns 500. Razorpay's retry then hits the unique `event_id` and gets `200 {duplicate:true}` **without processing**.
- **Impact:** if the browser `/verify` call did not complete (tab closed, network drop) and the first webhook delivery hit a transient error, the paid customer stays unactivated. There is no job that re-checks PENDING payments against Razorpay (production has 50 PENDING rows, all unresolved).
- **Note:** the working tree adds a lease-based `claim_razorpay_webhook`, but only when `affiliateEnabled()`.

### F-08 · P2 · Resume accepts any past payment as proof (release line)
- **Where:** `subscriptions.ts:906–931`. `hasCapturedSubscriptionPayment` (`:679`) accepts **any** captured subscription payment the org has ever made. `PAUSED`/`PAYMENT_FAILED` then become `ACTIVE` (`:929`) with no new payment and no check of the current period. A merchant can also undo a pause set by Super Admin.
- **Current exposure:** production has 0 PAUSED and 0 PAYMENT_FAILED rows, and coverage still ends at `current_period_end` for one-time orders. The gap is latent today.

### F-09 · P2 (needs an owner decision) · The trial cutoff is Oct 26/27, not Nov 1
- **Where:** `modules/billing/trial-policy.ts:3–30` and migration `20261030120000_business_trial_policy.sql`. Orgs joined **on or before 2026-10-26 IST** get `legacy_nov1` (trial ends 2026-11-01 00:00 IST). Orgs joined **from 2026-10-27** get `rolling_7d` (created_at + 7 days).
- **Against the stated policy** (joined before Nov 1 means paid from Nov 1): about **48 orgs that joined Oct 27–31 IST are on free trials ending Nov 3–7.** Commit `169749b` ("Business trial until Nov 1 or 7 days from signup") suggests this was deliberate. **NOT VERIFIED** which policy is authoritative.
- **Timezone handling is correct:** IST calendar date via `istCalendarDate`, and the SQL uses `timezone('Asia/Kolkata', created_at)::date`. The cutoff instant is `2026-10-31T18:30:00Z`. The cron expired the legacy cohort at **00:00:21 IST Nov 1** (127 `period_ended` rows). No TRIAL row has an end date at or before Nov 1.

### F-10 · P2 · UI makes a trial look like a paid subscription
- **Where:** `lib/api/v1/billing.ts:79` returns the trial as the top plan (Business). `app/dashboard/billing/page.tsx:134` shows "**Business · Current plan**". `components/billing/plan-picker.tsx:75` puts a "Current plan" badge on the Business card during the trial (only the button says "Pay for Business"). The payment history lists every closed checkout as a "Pending" row.
- **Effect:** on the current code, a trial merchant who picks Business and closes Checkout still sees "Business – Current plan", which looks subscribed. The UI is reading server data accurately; the wording is misleading.

### F-11 · P1 (only if the working tree is deployed) · Working tree activates on uncaptured payments
- **Where:** working tree `modules/billing/subscriptions.ts:350` accepts `status === "authorized"`. Its activation is multi-step TypeScript with no row lock, not the release RPC.

### F-12 · P3 · Smaller issues
- RPC sets `v_start := now()` (`…153000…sql:168`). Renewing or upgrading early **discards the remaining paid days**.
- `refund.processed` marks the payment REFUNDED but **never affects the subscription** (`webhooks.ts:554`).
- The fallback webhook ID (`webhooks.ts:21`) hashes only the first ~30 bytes of the body, which is the same for every event. Harmless while Razorpay sends `x-razorpay-event-id`.
- The trial-migration backfill (`…120000…sql:163–171`) turned **unpaid but admin-granted ACTIVE** plans into trials (the override column did not exist yet). Its "has captured payment" check ignores `payment_purpose`: org `9eee4a11` was skipped because of an AI-credits purchase. Both are already expired, so impact is low.
- The Super Admin revenue count includes unpaid ACTIVE rows (`admin/handle.ts:187`).

### Security questions (release line, live)

| Path | Result |
|---|---|
| Call an internal API directly to activate | **No.** `subscribe` never activates. `verify` needs a valid HMAC and Razorpay `captured`. The RPC is `service_role` only. `change-plan` refuses upgrades. Billing mutations are OWNER only. |
| Modify the frontend success response | **No.** The server fetches the payment from Razorpay. |
| Fake payment ID | **No.** The HMAC over `order_id|payment_id` fails. |
| Reuse a successful payment | **No.** The PENDING row can be claimed once. The same payment returns `duplicate`; a different payment on a CAPTURED order returns `forbidden`. Unit test 12. |
| Replay a webhook | **No.** HMAC plus unique `event_id`, and the RPC is idempotent. |
| Use another org's payment | **No.** The org is checked in TS and in the RPC. Unit test 11. |
| Success route without verification | **No** such route exists. |
| **Old line (if redeployed)** | **Yes.** Cancel→Resume gives ACTIVE (F-02), checkout start rewrites the plan (F-01), and `change-plan` applies upgrades without payment. |

---

## D. Root Cause Analysis

1. **Why an unpaid plan appeared subscribed:** before 2026-10-30, `startCheckout` saved the chosen plan and price on the live subscription before Razorpay Checkout opened (F-01). The billing page read that row back, so closing Checkout looked like it activated the plan. The dismissal handler did nothing; the database had already changed when the order was created. On the same day the reporter's org also used **Cancel→Resume**, which set `status=ACTIVE` with no payment (F-02). Together these gave "Business · ACTIVE · ₹3,500 · Current plan" with no money collected.
2. **Frontend vs backend:** **backend state corruption plus an authorization flaw.** It was not a rendering bug and not caused by the dismissal handler. The current UI adds a separate, smaller **presentation** problem: trials are labelled "Current plan" (F-10).
3. **Real access granted:** while ACTIVE (until Nov 1 00:00 IST) that org could book like a paid customer. Since the period ended, booking is blocked, but Business features stay unlocked because of F-05.

### Hypotheses

| # | Hypothesis | Verdict |
|---|---|---|
| A | Activated on plan selection | **Partially confirmed (old code):** plan, price and limits were written at selection. Status was not changed except when creating a new TRIAL row. Rejected for the live code. |
| B | Activated when the Razorpay order is created | **Confirmed (old code).** That happened in the same `startCheckout` call as A. Rejected for live. |
| C | Dismissal triggers a bad frontend update | **Rejected.** The old code had no dismissal handler. Live `ondismiss` only shows a toast. |
| D | Activation lacks payment verification | **Confirmed for `resumeSubscription` (old code)** and for `changePlan` upgrades (old code). Rejected for `verify`/webhook: HMAC plus a fetch from Razorpay. |
| E | Status defaults to active | **Rejected.** Old: inserted TRIAL. Working tree: EXPIRED. Release: no row. |
| F | UI renders pending as active | **Partially confirmed (cosmetic):** trial is shown as "Current plan". A PENDING payment is never shown as active. |
| G | Webhook or job makes a wrong transition | **Rejected as the cause.** Webhook defects (F-06, F-07) cause *missed* activations, not false ones. |
| H | The Nov 1 migration introduced bad records | **Rejected as the cause.** The migration *repaired* most old-code damage (unpaid ACTIVE back to TRIAL). `661ff3ca` was corrupted ~6 minutes **after** the migration ran (01:44 vs 01:50 UTC on 10-30), by old application code. Minor side effects are in F-12. |

---

## E. Trial & Billing Migration Findings

- **Existing merchants (joined ≤ Oct 26 IST, 128 orgs):** correctly put on `legacy_nov1` and correctly expired at Nov 1 00:00 IST (127 EXPIRED by the cron at 00:00:21). They get no new trial (`trial_claims` covers 177 orgs). Paid customers are intact (see G-18). **Gaps:** `661ff3ca` (F-04); feature access persists after expiry (F-05); admin-granted unpaid plans were turned into trials (F-12).
- **Merchants joined Oct 27–31 IST (~48):** on 7-day trials ending Nov 3–7. Whether this matches policy needs an owner decision (F-09).
- **New merchants (≥ Nov 1):** `create_organization_for_user` creates a server-side TRIAL: `now()` + `platform_settings.trial_days` (7), Business plan, `rolling_7d`. Duplicates are blocked by `trial_claims` on email or WhatsApp. Merchants cannot change trial dates: subscription writes are service-role or admin only, and billing mutations are OWNER only and none touch `trial_end`. One org created after the cutoff is on a rolling trial, as expected. Runtime signup was not tested.
- **Expiry enforcement:** booking is blocked server-side (`checkQuota` returns `TRIAL_ENDED_MESSAGE`). Feature routes are **not** blocked (F-05). The cron runs, unlike on 10-27.

---

## F. Razorpay Integration Findings

| Check | Live (release) |
|---|---|
| Signature validation | Checkout: HMAC-SHA256 over `order_id|payment_id`, compared in constant time. Webhook: HMAC over the raw body. ✔ |
| Payment status | Fetched from Razorpay. Only `captured` passes (`isCapturedRazorpayStatus`). `authorized` is rejected ✔. The working tree accepts `authorized` ✘ (F-11). |
| Order binding | `payment.order_id` must equal the checkout order ✔ |
| Amount / currency | Checked in TS and again in the RPC against the PENDING row ✔ |
| Plan / interval | Taken from the server-side PENDING row, never from the client ✔ |
| Tenant binding | `organization_id` checked in TS and the RPC. A foreign `subscription_id` is rejected ✔ |
| Idempotency | One PENDING claim with `FOR UPDATE`. Webhook `event_id` is unique ✔ |
| Events used | `payment.captured` (activation), `payment.failed`, `refund.processed`. The `subscription.*` and `invoice.paid` paths are unused. Production has received only 5 webhook events ever (2× payment.captured for plans, 1 for AI credits, 1 payment.failed, 1 refund). |
| Retry after failure | ✘ Never reprocessed (F-07) |
| Failed then succeeded on the same order | ✘ Ambiguous, so never activated (F-06) |
| Out of order | `payment.failed` after `captured` inserts a FAILED row with a different payment ID and does not downgrade one-time orders. Not tested. |
| Refunds | ✘ No effect on the subscription (F-12) |
| Authoritative activation rule | **Razorpay payment `captured` + order matches the single PENDING subscription purchase + org/amount/currency match → RPC.** This is correct for an Orders integration. |

---

## G. Test Results

Automated runs: **working tree** `modules/billing` + `modules/razorpay`: 18 files, **87/87 pass**. **Release snapshot** `c0be1e1`: 16 files, **106/106 pass**, including `checkout-security.test.ts`. These are mocked or PGlite tests; none touches Razorpay or a hosted DB. No browser or staging run was done: staging needs Docker and local Supabase, which are not installed, and real checkouts were out of scope.

| # | Scenario | Result | Evidence / limits |
|---|---|---|---|
| 1 | Select plan, close checkout | **PASS (live) / FAIL (old code)** | Release unit tests 1–3 and 20. Production history after 10-30 shows no plan rewrites on the release line. Old-line failure is proven by F-01 production rows. |
| 2 | Dismiss before payment | **PASS (live) / FAIL (old)** | `ondismiss` only shows a toast. Same evidence as #1. |
| 3 | Payment fails | **PASS** | Unit tests 4–6 and expired 4–6 |
| 4 | Payment succeeds and is verified | **PASS** | Unit test 7, and **production**: `69c03db9` ₹499 CAPTURED 10-31, ACTIVE Starter until 11-30, single history row `payment.captured` |
| 5 | Checkout says success, backend verification fails | **PASS** | Unit tests 8 and 9–10 |
| 6 | Refresh after a closed checkout | **NOT TESTED** | The page re-reads the server and no client state survives (code trace). No browser run. |
| 7 | Retry payment | **FAIL** | Retry inside the same Checkout after a failed attempt ends ambiguous and is not activated (F-06). A new checkout after closing is fine (unit tests 14–15). |
| 8 | Webhook delayed | **NOT TESTED** | `/verify` activates first and the later webhook is a duplicate (unit 13). If `/verify` is lost and the webhook fails once, the customer is never activated (F-07). |
| 9 | Duplicate webhook | **PASS** | Unit test 13 |
| 10 | Out-of-order webhooks | **NOT TESTED** | Code trace only |
| 11 | Replayed payment ID | **PASS** | Unit test 12 |
| 12 | New user registers Nov 1 | **NOT TESTED** | Code plus 1 production row consistent. No signup run. |
| 13 | Existing user registered before Nov 1 | **FAIL vs stated policy** | Joined ≤ Oct 26 correct. Oct 27–31 cohort is still on trial (F-09). |
| 14 | Trial expires | **FAIL** | Booking blocked ✔ (cron 00:00:21 IST). Feature APIs still open ✘ (F-05). |
| 15 | Payment from another org | **PASS** | Unit test 11 |
| 16 | Frontend shows active after dismissal | **FAIL (historical, backend cause)** | `661ff3ca`. Live code: trial still labelled "Current plan" (F-10). |
| 17 | Concurrent payment attempts | **PASS (mocked)** | Unit tests 8b and 9b. RPC row locks by code. Not run against Postgres concurrency. |
| 18 | Existing legitimately paid customer | **PASS** | `69c03db9` intact. `0fc1f89e` (₹1 captured 09-25) is untouched by the migration. |

---

## H. Production Impact Assessment (read-only)

**Snapshot, 2026-11-01 ~01:00 IST:** 181 orgs, 179 subscriptions. TRIAL 49 (all `rolling_7d`, 2 with admin override), ACTIVE 3, EXPIRED 127, others 0. Payments: PENDING 50, CAPTURED 3 (2 subscription, 1 AI credits), FAILED 1. No Razorpay subscriptions.

| Classification | Records |
|---|---|
| **Confirmed unpaid activation** | `661ff3ca`: ACTIVE Business, no payment; created by Cancel→Resume plus checkout rewrites on old code |
| Historical unpaid activation, already inactive | `face355a`: PAYMENT_FAILED→ACTIVE via resume (09-25). It is no longer ACTIVE. |
| Paid, legitimate | `69c03db9` (₹499, period to 11-30). `0fc1f89e` (₹1 test payment 09-25; period ended 10-25 but status still ACTIVE because the cron skips one-time ACTIVE rows) |
| Suspicious, needs review | 12 subscriptions with old-code plan rewrites (listed in F-01); all now TRIAL/EXPIRED except the two above. 1 duplicated order ID (F-06). |
| Policy question | ~48 rolling trials for orgs that joined Oct 27–31 (F-09) |

**Safe read-only queries for repeat checks** (run as a read-only role; they return no personal data):

```sql
-- 1. Live/ACTIVE subscriptions with no captured subscription payment in the current period
select s.id, s.status, p.slug, s.amount_paise, s.current_period_end
from subscriptions s join plans p on p.id = s.plan_id
where s.status in ('ACTIVE','PAST_DUE','PAUSED','PAYMENT_FAILED')
  and not exists (select 1 from payments x
                  where x.subscription_id = s.id and x.status = 'CAPTURED'
                    and x.payment_purpose = 'subscription'
                    and x.paid_at >= s.current_period_start - interval '1 day');

-- 2. Old-code fingerprints
select subscription_id, count(*) from subscription_history
where reason = 'checkout_started' and from_plan_id is distinct from to_plan_id group by 1;
select subscription_id, from_status, created_at from subscription_history
where reason = 'resumed' and to_status = 'ACTIVE' and from_status <> 'ACTIVE';

-- 3. Orders that will hit the "ambiguous" path (F-06)
select razorpay_order_id, count(*), array_agg(status) from payments
where razorpay_order_id is not null and payment_purpose = 'subscription'
group by 1 having count(*) > 1;

-- 4. Captured at Razorpay but still PENDING here: needs the Razorpay order API; list candidates
select id, razorpay_order_id, amount_paise, created_at from payments
where status = 'PENDING' and payment_purpose = 'subscription' and created_at < now() - interval '30 minutes';
```

---

## I. Recommended Fix Strategy (not executed; needs approval)

**Phase 0: stop the bleeding (operations, no code).**
1. Freeze billing-affecting deploys. Choose **one** code line. Recommendation: the **release line (`c0be1e1`)** as the base, because it has the purchase RPC and the P0 test suite. Port the working tree's useful parts into it (one-time ACTIVE expiry in cron, webhook claim/lease).
2. Mark `origin/main` and every older release branch as **do-not-deploy** until they are rebased onto the fixed line. Add a build SHA to `/api/health` so the live server code can be verified.

**Phase 1: data remediation (one reviewed DML script, run only with explicit approval).**
3. Move `661ff3ca` to `EXPIRED` and write a `subscription_history` row (`reason='audit_unpaid_activation_reverted'`) so it can be reversed. Optionally contact the org.
4. Review the 12 F-01 subscriptions and the duplicated order. No change is expected, because all are already TRIAL/EXPIRED.

**Phase 2: code fixes (smallest safe set, in priority order).**
5. **F-05:** `getOrganizationEntitlements` returns no paid features when `coverageEnded`, `status` is not live, or the trial has ended. `assertPlanFeature` then fails closed. *No migration.*
6. **F-06:** `payment.failed` should update the PENDING row's failure fields instead of inserting a row. Alternatively, have the RPC and `resolvePurchaseByOrder` count only `PENDING`/`CAPTURED` rows when checking ambiguity. *RPC change = migration* (`create or replace function`, keep the old body for rollback).
7. **F-07:** let `failed` webhook events be reprocessed (make the existing `claim_razorpay_webhook` lease unconditional; *its migration must be applied*). Add a scheduled reconciliation for stale PENDING payments: fetch the Razorpay order and, if captured, call the same RPC. *No new schema.*
8. **F-08:** Resume only clears `cancel_at_period_end`. Never move PAUSED/PAYMENT_FAILED to ACTIVE without a captured payment for the current period. No self-resume of an admin pause. *No migration.*
9. **F-04 / cron:** expire one-time ACTIVE rows after their period ends, respecting `trial_manual_override`. This is already in the working tree; port it. **Side effect:** `0fc1f89e` and `661ff3ca` become EXPIRED.
10. **F-10 (UI):** show a "Trial" badge instead of "Current plan" during a trial. Show "Payment not completed" for the latest PENDING checkout instead of a bare "Pending" row.
11. **F-09:** owner decision on the Oct 27–31 cohort. If they must pay from Nov 1, use a targeted DML that sets `trial_end = 2026-11-01 00:00 IST` for those orgs with an audit row. **Do not** change history silently.
12. **F-11:** if any working-tree code survives, reject `authorized`.
13. **F-12 (later):** carry over unused paid days on renewal or upgrade; let a refund end coverage; strengthen the fallback webhook ID; base the revenue view on captured payments.

**Regression prevention:** add tests for (a) payment.failed then captured on the same order, (b) a webhook that fails, then a retry that activates, (c) feature APIs after trial expiry and after one-time period end, (d) resume on PAUSED/PAYMENT_FAILED without current payment, (e) a CI guard that fails if `startCheckout` writes `plan_id`/`status` to `subscriptions`.

**Rollback:** steps 5, 8, 9, 10 and 12 are code-only and revert with git. Step 6/7 RPC changes: keep the previous function definitions in a down-script. Data steps write history rows with the old values so they can be reversed.

**Fix risks:** step 5 locks expired orgs out of analytics, invoices and integrations they use today, so plan the communication. Step 9 expires 2 ACTIVE rows. Step 11 cuts ~48 trials short. Step 6 changes the core activation RPC, so test it on staging with Razorpay test mode first.

---

## J. Final Decision Summary

1. **Is the reported bug confirmed?** **Yes.** Production subscription `661ff3ca` went ACTIVE on Business with no payment on 2026-10-30.
2. **Exact root cause:** old `startCheckout` saved the selected plan and price on the live subscription when the order was created (F-01), and old `resumeSubscription` set ACTIVE without payment (F-02). Closing Checkout was not the trigger.
3. **Frontend-only or backend?** **Backend** (state corruption plus missing authorization). There is also a minor current UI labelling issue (F-10).
4. **Can users get paid access without paying?** **On the live code: no paid activation**, but **expired users keep paid feature APIs** (F-05). **On the old branches: yes**, and they can be redeployed (F-03).
5. **Is Razorpay verification correct?** **On the live line, yes** for the happy path, signatures, tenant, amount and replay. **Missed activations are possible:** F-06 failed-then-retry, F-07 webhook retry. The working tree accepts `authorized` (F-11).
6. **Is the 7-day trial correct?** **Mostly.** Server-side, deduplicated and timezone-correct. Expiry blocks booking but not features (F-05). Signup flow NOT VERIFIED at runtime.
7. **Is the Nov 1 existing-user migration correct?** **Partly.** The ≤ Oct 26 cohort is correct and expired on time. The Oct 27–31 cohort contradicts the stated policy (F-09, owner decision). Admin-granted plans were not preserved (F-12). One corrupted row remains (F-04).
8. **Fix first:** Phase 0 (one deployable code line, block old branches), then expire `661ff3ca`, then F-05, F-06 and F-07.
9. **Risks of the fix:** lockouts and support load from F-05, F-09 and the cron change. RPC regressions in F-06. Merging the code lines may conflict.
10. **Is the app safe for paid billing in its current condition?** **No.** Not until Phase 0 and the F-05, F-06 and F-07 fixes are in and verified on staging with Razorpay test mode.

**NOT VERIFIED:** the exact commit running on the production server (inferred from the bundle); browser behaviour of the billing page; end-to-end Razorpay test-mode runs; Postgres-level concurrency; new-signup trial creation at runtime; which cutoff policy is authoritative.

# PostBus Razorpay Phase 1 — Staging Verification Report

**Date:** 2026-10-10  
**Scope:** Local isolated Postgres only (`postbus_staging` on `127.0.0.1:55432`)  
**Forbidden target:** hosted production project `hgacoeoovjxkzfbesmvl` — **not used**  
**Merchant Razorpay:** out of scope (not implemented in this run)

This report does **not** authorize production deployment.

---

## A. Executive Summary

Phase 1 security hardening was verified against the **user-authorized local staging cluster**, not a hosted Supabase project.

| Area | Result |
| --- | --- |
| Environment identity | **PASS** — `postbus_staging` / `127.0.0.1:55432`; production ref unused |
| Migration apply (local) | **PASS** — `20261010080000_platform_settings_secrets_rls.sql` applied after a local fixture table |
| Effective grants/policies | **PASS** — no `anon`/`authenticated`/`public` grants; unrestricted SELECT policy dropped |
| JWT-equivalent table access | **PASS** — `anon`/`authenticated` `permission denied for table platform_settings` |
| Local `service_role` row read | **PARTIAL** — GRANT exists; **0 rows** because local `service_role` has `rolbypassrls=false` and no RLS policy remains (hosted Supabase `service_role` typically bypasses RLS — **NOT VERIFIED** on hosted) |
| Hosted `GET /rest/v1/platform_settings` | **BLOCKED** — no authorized hosted staging project |
| Live `/api/admin/trial-settings` | **BLOCKED** — process env `NEXT_PUBLIC_SUPABASE_URL` unset in this shell; would not hit production |
| Live Razorpay checkout/capture/refund | **BLOCKED** — no sandbox charges issued |
| Unit/PGlite tests | **PASS** — 5 files, **23/23** |

**Final decision: YELLOW — PARTIALLY VERIFIED**

---

## B. Environment Verification

| Item | Evidence |
| --- | --- |
| Authorized target | User confirmed **local** `scripts/staging` Postgres (`postbus_staging`) |
| Gate | `node` import of [`scripts/staging/gate.mjs`](scripts/staging/gate.mjs): `STAGING_HOST=127.0.0.1`, `STAGING_PORT=55432`, `STAGING_DATABASE=postbus_staging`, `ENVIRONMENT=postbus-staging-local`, `PROVIDER_MODE=STUB`, `PRODUCTION_PROJECT_REF=(not used)` |
| Ready | `pg_isready -h 127.0.0.1 -p 55432` → accepting connections |
| SQL identity | `current_database()=postbus_staging`, `inet_server_addr()=127.0.0.1/32`, `inet_server_port()=55432` |
| Production | [`scripts/staging/assert-not-production.mjs`](scripts/staging/assert-not-production.mjs) forbids `hgacoeoovjxkzfbesmvl`; not used |
| Hosted CLI project | Not selected for this run |
| App URL in this shell | `NEXT_PUBLIC_SUPABASE_URL` **unset**; `HOST_IS_PRODUCTION_REF=false` |

**State-changing operations performed (local only):**

1. Created a **staging-only fixture** `public.platform_settings` (table was missing; local bootstrap is India Post lock schema, not full SaaS). Dummy key id `rzp_test_fixture`; ciphertext was fixture placeholder, not printed after migrate.
2. Applied [`supabase/migrations/20261010080000_platform_settings_secrets_rls.sql`](supabase/migrations/20261010080000_platform_settings_secrets_rls.sql) via local `psql -f`.

No `supabase db push`. No production writes.

---

## C. Migration Verification

**Before apply:** `has_platform_settings = f`. Roles `anon`, `authenticated`, `service_role` existed (`rolbypassrls` false except table owner `postbus_staging` true).

**Apply output (local):** `REVOKE` ×3, `GRANT`, `DROP POLICY`, `COMMENT`.

**After apply:**

- Policies on `platform_settings`: **none** (`platform_settings_admin_select` gone).
- Grants: `service_role` SELECT/INSERT/UPDATE/DELETE; table owner `postbus_staging` default owner privileges. **No** `anon`, `authenticated`, or `public` grants in `role_table_grants`.

**Remaining concern:** Hosted Supabase `service_role` is expected to `BYPASSRLS`. Local `service_role` does not. After dropping all policies, a non-bypass role with table GRANT still sees **zero rows**. That matches Postgres RLS default-deny. It does **not** prove hosted PostgREST behavior. Production must not be inferred from this cluster.

---

## D. API Security Results

### Test 1 — Anonymous (local role, not PostgREST)

`SET ROLE anon; SELECT ... FROM public.platform_settings`  
**Result:** `ERROR: permission denied for table platform_settings`  
No secret columns returned.

**Hosted** `GET /rest/v1/platform_settings?id=eq.1` with anon key: **BLOCKED**.

### Test 2 — Authenticated non-admin (local role)

`SET ROLE authenticated; SELECT ...` → permission denied.  
`UPDATE ... SET trial_days = 1` → permission denied.

No hosted Auth user session: **BLOCKED**.

### Test 3 — Authorized server-side

**Code:** [`modules/razorpay/config.ts`](modules/razorpay/config.ts) `loadSettingsRow()` uses `createAdminClient()` (service role), not the user JWT.

**Local SQL:** `SET ROLE service_role; SELECT length(encrypted_razorpay_key_secret), left(razorpay_key_id, 8)` succeeded at the privilege layer (`OK service_select_len`) but returned **0 rows** (no BYPASSRLS, no policy). Ciphertext was not printed.

Hosted service-role read of production/staging cloud: **not executed**.

### Test 4 — Alternate paths

- No `app/api/admin/trial-settings/route.ts` (confirmed absent). Catch-all: [`app/api/admin/[...slug]/route.ts`](app/api/admin/[...slug]/route.ts) → [`lib/api/admin/handle.ts`](lib/api/admin/handle.ts).
- Trial handlers select only `trial_enabled, trial_days` (unit test PASS).
- Live HTTP to production or customer trial settings: **not executed**.

---

## E. Trial Settings Results

| Check | Result |
| --- | --- |
| Route | `GET`/`PATCH` `/api/admin/trial-settings` via admin slug handler; `requirePlatformAdmin()` |
| Field restriction (unit) | `lib/api/admin/trial-settings.test.ts` — select list is `trial_enabled, trial_days` |
| Live GET/PATCH | **BLOCKED** — no local Next.js session against non-production Supabase in this run |
| Invalid input | Schema in handle.ts: `trialDays` 0–90 integer; **not** hit live |
| Manual next step | Against a **non-production** app: Super Admin GET must omit encrypted columns; PATCH only trial fields |

---

## F. Webhook Security Results

Implementation inspected: [`modules/billing/webhooks.ts`](modules/billing/webhooks.ts) `classifyPlatformRazorpayPayment`, [`app/api/webhooks/razorpay/route.ts`](app/api/webhooks/razorpay/route.ts). No live Razorpay events sent.

| ID | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| A | Invalid signature | `signature.test.ts` tampered HMAC; `ai-credits/webhooks.test.ts` bad HMAC | **PASS** (unit) |
| B | Valid signature | HMAC over raw body accepted | **PASS** (unit) |
| C | AI Credits grant-once | `grants credits once for payment.captured on an AI credit order` | **PASS** (unit) |
| D | Subscription capture | `activates a trial from payment.captured using the Razorpay order id`; `subscription.charged` period extend | **PASS** (unit) |
| E | Amount mismatch | `ignores payment.captured when the paid amount does not match`; AI amount mismatch does not grant | **PASS** (unit) |
| F | Unmatched reference | `ignores payment.captured for an unknown Razorpay order`; AI unmatched does not grant | **PASS** (unit) |
| G | Duplicate events | helper unique violation; second capture same payment id does not insert second row; AI duplicate does not double-grant | **PASS** (unit). Route-level `event_id` unique **not** live-tested |
| H | Refund | unknown id ignored; matching id marked REFUNDED | **PASS** (unit) |
| I | Ignored events | unmatched subscription / payment logged; route maps `ignored` status in code | **PASS** (unit). Live `razorpay_webhook_events` table **not** on this local cluster |

---

## G. Billing Regression Results

| Flow | Result |
| --- | --- |
| Subscription purchase E2E | **BLOCKED** (no Razorpay sandbox charge) |
| Payment verify E2E | **BLOCKED** |
| Renewal (`subscription.charged` / `invoice.paid` idempotent period) | **PASS** (unit) |
| AI Credits purchase E2E | **BLOCKED** |
| AI Credits grant-once | **PASS** (unit) |
| Signature validation | **PASS** (unit) |
| Duplicate webhook handling | **PASS** (unit / helper); live inbox **NOT VERIFIED** |
| Amount mismatch | **PASS** (unit) |
| Refund processing | **PASS** (unit) |
| Trial settings access live | **BLOCKED** |
| WhatsApp Store / India Post COD | Not modified this run; no live booking against production |

Platform Domain A freeze is documented in [`docs/billing.md`](docs/billing.md) and comments on [`modules/razorpay/client.ts`](modules/razorpay/client.ts) / [`config.ts`](modules/razorpay/config.ts). **Do not claim a complete purchase flow works from unit tests.**

---

## H. Test Evidence

Commands executed (local):

1. `node -e` import `printSafetyGate()`
2. `pg_isready.exe -h 127.0.0.1 -p 55432`
3. Redacted env host check (`NEXT_PUBLIC_SUPABASE_URL` unset)
4. `node .staging/verify-phase1-preflight.mjs inspect` (before/after)
5. `node .staging/verify-phase1-preflight.mjs fixture` (local table only)
6. `node .staging/verify-phase1-preflight.mjs migrate` (`psql -f` migration file)
7. `node .staging/verify-phase1-preflight.mjs roles`
8. `npx vitest run` (files below) — **23 passed / 0 failed**, Vitest v4.1.11

Test files:

- `modules/billing/webhooks.test.ts`
- `modules/ai-credits/webhooks.test.ts`
- `modules/razorpay/signature.test.ts`
- `modules/razorpay/platform-settings-rls.pg.test.ts`
- `lib/api/admin/trial-settings.test.ts`

PGlite RLS (in-process, not this Postgres): anon/authenticated cannot read secrets; `service_role` **with BYPASSRLS in the test harness** can select encrypted columns.

Tests not run: hosted PostgREST, Super Admin HTTP, Razorpay Dashboard webhooks, production or hosted staging SQL.

---

## I. Remaining Risks

1. **Hosted PostgREST** may still expose `platform_settings` until this migration is applied on a **non-production** hosted project and re-tested with the anon key.
2. Local `service_role` **without** `BYPASSRLS` cannot read rows after policy drop; hosted billing depends on Supabase’s bypass. Confirm on hosted staging before production migrate.
3. Live trial-settings envelope was not captured from a running admin session.
4. Webhook route idempotency and `ignored` status writes were not exercised against a real `razorpay_webhook_events` table on this cluster.
5. Applying the same SQL on production without a backup and hosted staging proof remains **out of scope and not approved**.

---

## J. Final Decision

**YELLOW — PARTIALLY VERIFIED**

Local grants/revokes match the migration intent. Unit and PGlite tests passed. Hosted anon REST, live admin trial-settings, and Razorpay sandbox E2E were not executed.

A GREEN result would require an authorized **hosted** staging project (explicitly not `hgacoeoovjxkzfbesmvl`) with the migration applied and PostgREST + admin HTTP + optional Razorpay test-mode checks.

**Not production-ready. No deploy. No merchant Razorpay work. Stopped after this report.**

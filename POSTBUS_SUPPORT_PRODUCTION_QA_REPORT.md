# PostBus Support Center — Production Automated QA Report

Generated: 2026-10-09  
Auditor: automated production QA (read-only against live systems; mutations isolated to Vitest/PGlite)  
Workspace HEAD at audit time: `531c08834a86bf0d5dd0924020840cae48542e71` (`india-post-true-bulk-candidate`)

**Final decision: YELLOW — PARTIALLY VERIFIED / NON-CRITICAL GAPS**

Essential authenticated inbox, live inbound WhatsApp, Coolify drain env, and Realtime were not exercised. No P0 tenant-leak was observed in isolated RLS tests or read-only production inspection.

---

## A. Environment

### Machine-readable verification

```json
{
  "application": "https://www.postbus.in",
  "healthHttp": 200,
  "health": {
    "api": "Healthy",
    "database": "Healthy",
    "redis": "Disabled",
    "jobRunner": "database",
    "jobs": "Warning",
    "shopify": "Warning",
    "indiaPost": "Warning"
  },
  "supabaseProject": "hgacoeoovjxkzfbesmvl",
  "supabaseName": "POSTBUS",
  "supabaseOrg": "ehfsglexlxglpxwpsfbj",
  "supabaseStatus": "ACTIVE_HEALTHY",
  "mcpUrl": "https://hgacoeoovjxkzfbesmvl.supabase.co",
  "expectedReleaseSha": "37624165810d01a724f142f564592e2d11028559",
  "originSupportCenterRelease": "37624165810d01a724f142f564592e2d11028559",
  "coolifyApplicationUuid": "mw9larpomkyonxzy1rk3h6jm",
  "coolifyDeploymentUuidClaimed": "zz2k1wonywbnpoztmhr3zcuh",
  "coolifyApi": "NOT_VERIFIED",
  "localCoolifyDeployFile": "l2ol82b5lb4tmqlfwijtfmy0",
  "workerJobRunner": "database",
  "supportIngestInCode": true,
  "supportIngestInOtherLane": true,
  "coolifyOtherDrainEnv": "NOT_VERIFIED",
  "featureFlags": {
    "orgs": 31,
    "supportCenterEnabled": 2,
    "modePostbusGlobal": 31,
    "modeMerchantVachat": 0,
    "platformVachatEnabled": true,
    "platformVachatSupportEnabled": true
  }
}
```

### Production commit

| Target | Value | Result |
|---|---|---|
| Claimed production SHA | `37624165810d01a724f142f564592e2d11028559` | Matches `origin/support-center-release` |
| Message | `fix: harden support tenant isolation and inbox workflows` | Confirmed |
| Coolify live SHA | — | **NOT VERIFIED** (no Coolify API token in local `.env.local`) |
| Local workspace vs SHA | Support modules identical; `workers/processor.ts` + bulk migration differ | Workspace is not a clean checkout of the release |

Support Center source on this machine matches the release SHA. India Post bulk-booking worker changes are local/unreleased relative to `3762416` and were not deployed as part of this audit.

### Workers / drain

- Production `jobRunner` is `database` (cron drain, Redis disabled).
- `support-ingest` is a `JOB_TYPES` member and is included in `OTHER_JOB_TYPES` (`postbus-other-drain` lane in code).
- Coolify scheduled job `JOB_TYPES=` env for `postbus-other-drain` was **not** read from the server.

### Database connectivity

- `/api/health` database: Healthy  
- MCP `execute_sql` against `hgacoeoovjxkzfbesmvl`: succeeded (read-only)

No schema changes, migrations, deploys, or WhatsApp sends were performed.

---

## B. Test summary

| Bucket | Result |
|---|---|
| Total executed this run | **368 passed / 0 failed / 0 skipped** |
| Support + Vachat + new QA tests + RBAC + job lanes + Shopify/India Post subset | 50 files |
| Playwright | **Not in repository** — not installed |
| Browser (Cursor browser, production, unauthenticated) | Login gate verified |
| Authenticated UI | **NOT VERIFIED** |
| Live signed webhook | **NOT SENT** (policy) |
| Live WhatsApp | **BLOCKED** |

New isolated tests added (no extra packages):

- `tests/support/api/production-read-only.test.ts` (gated by `POSTBUS_PROD_QA=1`)
- `tests/support/whatsapp/signature-matrix.test.ts`
- `tests/support/tickets/schema-validation.test.ts`
- `tests/support/regression/search-performance.test.ts`
- `lib/jobs/job-lanes.test.ts` — `support-ingest` in other lane

Existing coverage reused: `modules/support/**`, `modules/vachat/**`, `lib/permissions/rbac.test.ts`, `lib/api/v1-permissions.test.ts`.

---

## C. Security

### Tenant isolation (isolated PGlite)

Passed: Org A cannot read/update Org B tickets, conversations, messages, attachments; composite FK blocks cross-org order links; VIEWER cannot update; merchants cannot read Super Admin unassigned queue.

### Duplicate Shopify `#1052`

Passed in unit tests: unique order+phone assigns; two merchants with `#1052` quarantines; order number alone does not select a merchant.

Hosted two-tenant Auth sessions: **NOT VERIFIED** (no production writes; no dedicated staging Auth users in this run).

### Production RLS / grants (read-only)

- All `support_*` tables have RLS enabled.
- Merchant tables have membership policies (SELECT/write as designed).
- `support_global_binds`, `support_identity_resolutions`, `support_unassigned_threads`, `support_unassigned_messages`: RLS on, **no policies**, **no anon/authenticated table grants** — deny-all except owner/service_role. Advisor INFO is expected, not a leak.
- Anon table grants on Support tables: **none** (migration `support_revoke_anon_grants` is applied in production as `20261009140728`).
- Authenticated still has table-level `TRUNCATE` (and TRIGGER/REFERENCES) on merchant Support tables. PostgreSQL RLS does not apply to `TRUNCATE`. PostgREST does not expose TRUNCATE; this is defense-in-depth, not an API exploit path.

### Webhook HMAC

Local matrix passed: valid, missing, invalid, expired, future, tampered body, 300s boundary.

Production unsigned POST `/api/v1/integrations/vachat/webhooks` → **HTTP 403** `FORBIDDEN` / `Invalid Vachat webhook signature.`  
Malformed JSON unsigned → **HTTP 403** (signature checked before parse).  
Valid signed production webhook: **not sent**.

### Authentication / API

| Probe | HTTP | Code |
|---|---|---|
| GET `/api/v1/support/conversations` no session | 401 | AUTH_REQUIRED |
| GET `/api/v1/support/tickets` invalid cookie | 401 | AUTH_REQUIRED |
| GET `/api/v1/support/settings` no session | 401 | AUTH_REQUIRED |

Expired JWT as a live session: **NOT VERIFIED** (would require minting tokens). Missing/invalid org: covered by `requireTenant` unit path (`TENANT_ACCESS_DENIED`) — hosted **NOT VERIFIED**.

Operator vs owner settings, disabled merchant Support: covered by unit/RBAC tests, not live sessions.

### Secrets

Health JSON and API errors contained no service-role keys or webhook secrets. `NEXT_PUBLIC_*` only for public URL/anon key by design.

---

## D. Functional

| Area | Evidence | Status |
|---|---|---|
| Inbox list/search | Unit + debounce sanitizer | Isolated PASS |
| Tickets / assign / notes / workflow | Schema + tickets module tests | Isolated PASS |
| Provider selection / no silent fallback | `provider.test.ts` | Isolated PASS |
| Inbound identify / ingest / assign-ingest | Module tests | Isolated PASS |
| Production inbox data | 0 conversations, 0 tickets, 0 messages, 0 unassigned | **Never exercised live** |
| `support-ingest` jobs | 0 rows | **No production ingest** |
| Background job processor | Code routes `support-ingest`; live drain env **NOT VERIFIED** | Partial |

---

## E. UI

Playwright is not a project dependency. Production checks used the Cursor browser (read-only).

| Check | Result |
|---|---|
| `/dashboard/support` unauthenticated | Redirect `https://www.postbus.in/login?next=%2Fdashboard%2Fsupport` |
| Desktop 1440×900 login gate | Renders; Email/Password/Sign in; skip-to-content link |
| Mobile 390×844 login gate | Same form; authenticated inbox **NOT VERIFIED** |
| `/dashboard/orders` unauthenticated | Redirect `login?next=%2Fdashboard%2Forders` |
| Conversation list, search, composer, assignment, empty/error states | **NOT VERIFIED** |
| Accessibility beyond login landmarks | **NOT VERIFIED** |
| Authenticated browser errors | **NOT VERIFIED** |

---

## F. Regression (shipping)

Isolated tests passed in this run: Shopify orders/oauth/http; India Post booking-service, booking-idempotency, booking-lock, webhook.

Production `/api/health`: `shopify: Warning`, `indiaPost: Warning` (configuration presence, not a failed booking).

Production queue (read-only):

- Last 24h: 129 SUCCEEDED, 15 FAILED
- Open: **14 QUEUED `shipment-booking`**, **15 FAILED `shipment-booking` (24h)**
- `count_overdue_background_jobs()` = **14** → health `jobs: Warning`

No bookings, labels, or order mutations were created.

---

## G. Performance

- Local: 1,000 search sanitize/query-string iterations **< 50ms** (synthetic CPU test).
- 100 / 1,000 conversations / 10,000 messages DB load: **NOT RUN** (would require a large isolated dataset; not production).
- Production load test: **not approved / not run**.

---

## H. Production monitoring

| Signal | Value |
|---|---|
| Support ingest pending/running/failed | none |
| Shipping overdue queued bookings | 14 |
| Shipping failed (24h) | 15 |
| Worker | database drain; Redis disabled |
| Unsigned webhook | rejected 403 |
| Coolify worker process list | **NOT VERIFIED** |

---

## I. Bugs

### BUG-SC-001

- **Severity:** P2  
- **Component:** Database grants  
- **Environment:** Production `hgacoeoovjxkzfbesmvl`  
- **Description:** `authenticated` holds `TRUNCATE` on merchant Support tables. RLS does not apply to `TRUNCATE`.  
- **Steps:** `information_schema.role_table_grants` for `support_tickets` et al.  
- **Expected:** `SELECT/INSERT/UPDATE/DELETE` only, matching PGlite test grants.  
- **Actual:** also TRUNCATE, TRIGGER, REFERENCES.  
- **Root cause:** default table grants after `GRANT ALL` / Supabase authenticated defaults; revoke migration only targeted `anon`.  
- **Affected files:** `supabase/migrations/20261009190000_support_revoke_anon_grants.sql`  
- **Recommended fix:** `REVOKE TRUNCATE, TRIGGER, REFERENCES ON ... FROM authenticated;` after staging review. Do not apply in this audit.  
- **Regression test:** grant query in a pg test asserting no TRUNCATE for authenticated.

### BUG-SC-002

- **Severity:** P2 (shipping reliability, not Support ingest)  
- **Component:** `background_jobs` / booking drain  
- **Environment:** Production  
- **Description:** Health `jobs: Warning` with 14 overdue queued `shipment-booking` jobs and 15 failures in 24h.  
- **Expected:** overdue count 0.  
- **Actual:** `count_overdue_background_jobs() = 14`.  
- **Root cause:** booking drain not clearing queued jobs (not investigated beyond counts; no payload printed).  
- **Recommended fix:** inspect booking drain on Coolify (read-only) in a shipping incident, not a Support rollout blocker unless merchants are stuck.  
- **Regression test:** existing drain/booking tests; production remaining **NOT VERIFIED** for root cause.

### BUG-SC-003

- **Severity:** P2 (release evidence gap)  
- **Component:** Inbound Support pipeline  
- **Environment:** Production  
- **Description:** Zero Support conversations, tickets, messages, unassigned threads, and `support-ingest` jobs. Dual WhatsApp ingest has never been proven on production data.  
- **Expected:** after enablement, at least synthetic staging traffic.  
- **Actual:** empty Support tables; 2 orgs flagged enabled.  
- **Root cause:** no live inbound; WhatsApp E2E blocked by policy.  
- **Recommended fix:** dedicated staging WhatsApp E2E, then a single authorized production canary.  
- **Regression test:** existing identify/ingest tests (pass locally).

### BUG-SC-004

- **Severity:** P3  
- **Component:** Release verification  
- **Environment:** Local vs Coolify  
- **Description:** Claimed deployment `zz2k1wonywbnpoztmhr3zcuh` and live git SHA could not be confirmed via Coolify API. Local `.coolify-deploy-uuid.txt` contains `l2ol82b5lb4tmqlfwijtfmy0`.  
- **Expected:** API returns commit `37624165810d01a724f142f564592e2d11028559`.  
- **Actual:** Coolify credentials absent locally.  
- **Recommended fix:** verify in Coolify UI or supply a read-only API token for the next audit.

Advisor notes (not new Support defects): Auth leaked-password protection disabled; several pre-existing SECURITY DEFINER EXECUTE grants (India Post/public tracking). `next_support_ticket_number` is authenticated-only and checks `is_org_member`.

---

## J. Final decision

**YELLOW — PARTIALLY VERIFIED / NON-CRITICAL GAPS**

GREEN is not appropriate: authenticated inbox, Realtime, Coolify drain configuration, and live inbound WhatsApp were not actually exercised. No P0 cross-tenant leak was found in isolated RLS or production grant inspection.

Do not expand merchant rollout on production WhatsApp until a dedicated staging (or authorized canary) inbound path creates tickets that a merchant session can see.

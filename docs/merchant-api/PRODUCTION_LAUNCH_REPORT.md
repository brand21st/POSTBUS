# PostBus Developer Platform v1 — production launch report

Date: 2026-10-19 (Asia/Kolkata). Operator: production preflight on `https://www.postbus.in`.

**General release: NOT APPROVED.**

Release stage: **Stage A (webhooks/docs not on the running SHA) + Stage B REST canary from a prior smoke**. Stage C is closed.

## 1. Deployment commit / version

| Item | Value | Status |
|---|---|---|
| Coolify application | `mw9larpomkyonxzy1rk3h6jm` | PASS |
| Production FQDN | `https://www.postbus.in` | PASS |
| Coolify `git_branch` | `release/auth-session-on-prod` | PASS |
| Coolify `git_commit_sha` | `fd9021236e9c8e136ca20b80a38d1c0621c475a5` | PASS |
| Coolify status | `running:healthy` | PASS |
| Working tree HEAD | `b3de2b8a9555072daa94374c03fcb2ecca994dd1` (print-labels; dirty) | BLOCKED for this launch |
| Isolated merchant-expansion SHA | Missing (webhook + `/developers` not in `fd90212`) | BLOCKED |

Message on production SHA: *Ship Merchant API v1 behind an org allowlist so production can roll out without opening every workspace.*

## 2. Production environment

| Check | Result |
|---|---|
| `GET /api/health` | PASS — `api`/`database` Healthy, `jobRunner=database` |
| `jobs` / `shopify` / `indiaPost` | FAIL — `Warning` (pre-existing; not Merchant API 5xx) |
| `INTEGRATION_ENCRYPTION_KEY` present | PASS (value not printed) |
| `SUPABASE_SERVICE_ROLE_KEY` present | PASS (value not printed) |
| `JOB_RUNNER` present | PASS |
| `MERCHANT_API_ENABLED` | true |
| `MERCHANT_API_ORG_ALLOWLIST` | 1 UUID (canary; value not printed) |
| `MERCHANT_WEBHOOKS_ENABLED` | **absent** (code treats missing as enabled, allowlist still required) |
| `MERCHANT_WEBHOOKS_ORG_ALLOWLIST` | **absent** → empty → **all orgs denied** |
| `/api/v1` session auth | NOT MODIFIED for this launch (TypeScript narrowing only on webhook create body; not deployed) |

## 3. Migration verification

See [PRODUCTION_MIGRATION_PLAN.md](PRODUCTION_MIGRATION_PLAN.md).

| Migration name | Production | Status |
|---|---|---|
| `merchant_public_api` | applied `20261018133307` | PASS |
| `merchant_api_consume_rate_service_role_only` | applied `20261018133359` | PASS |
| `merchant_webhook_platform` | applied `20261018191255` | PASS |

Re-apply: **do not**.

## 4. Database changes applied

Additive only. Tables/RLS verified: `merchant_api_request_logs`, `merchant_api_rate_buckets`, `webhook_events`, existing `webhook_endpoints` / `webhook_deliveries`. RPC execute: service_role only.

Outbox: `webhook_events` count **0**. Deliveries last 7 days: **0**.

## 5. Public API status

Namespace: `https://www.postbus.in/api/merchant/v1`

| Component | IMPLEMENTED (repo) | DEPLOYED (`fd90212`) | LIVE VERIFIED |
|---|---|---|---|
| Catch-all `/api/merchant/v1` | yes | yes | yes (401 envelope) |
| Identity / orders / shipments / tracking / labels | yes | yes | **prior canary smoke 2026-10-18** — see [PRODUCTION_SMOKE_REPORT.md](PRODUCTION_SMOKE_REPORT.md). **Not re-run 2026-10-19** (no live key minted; no India Post booking). |
| Webhook subscription routes | yes | **no** (`webhook-routes.ts` not in SHA) | no |
| Outbound webhook worker payload (HMAC event id) | yes | **no** | no |

Unauthenticated probe 2026-10-19:

- `GET /me` → **401** `INVALID_API_KEY` `api_version=v1` — PASS
- `GET /webhook-subscriptions` → **401** same envelope — proves catch-all auth, **not** that webhook handlers exist

## 6. Developer Portal status

Dashboard → Integrations → Developer API: **BLOCKED** (no production merchant session this run).

Prior smoke: portal mint/copy/revoke on www.postbus.in **BLOCKED**; local allowlist hide card **PASS**.

## 7. Developer documentation URLs

All **404** on production (`dev_http=404`, `openapi_http=404`). Repo has pages; they are **not** in `fd90212`.

Local implementation includes `/developers`, quickstart, authentication, api-reference, orders, shipments, tracking, webhooks, integrations, build-with-ai, changelog, `openapi.json`, `openapi.yaml`.

Typecheck fix: JSX `{id}` in quickstart was a compile error; escaped as a string.

## 8. API authentication results

| Test | Status |
|---|---|
| Missing key → 401 | PASS (production HTTP 2026-10-19) |
| Valid HMAC key on canary org | PASS (prior smoke) |
| Invalid key | PASS (prior smoke) |
| Insufficient scope | TESTED locally; production portal **BLOCKED** |
| Revoke / expire / rotate | BLOCKED this run (no new keys) |
| Tenant isolation (other-org ids) | PASS (prior smoke) |
| Logs without full secrets | PASS (prior smoke metadata) |

## 9. Orders API results

Prior canary smoke: create + list + get, `source=API`, idempotency replay, `IDEMPOTENCY_CONFLICT`. **NOT TESTED** again 2026-10-19. No extra customer orders created.

## 10. Booking safety verification

Code: `runBookingNow: false` on Merchant create. This launch did **not** call `POST /orders/{id}/book`. **PASS** for “no live CEPT this run”. Worker side effects for a new API order were not re-exercised.

## 11–13. Shipment / tracking / label APIs

Prior smoke: same-org tracking + label **PASS**; other-org **404**. **NOT TESTED** 2026-10-19.

## 14–15. Webhook subscriptions and delivery

| Test | Status |
|---|---|
| Register / list / patch / delete | IMPLEMENTED, DEPLOYED **no**, LIVE **NOT TESTED** |
| Signed test delivery | NOT TESTED |
| Retry / rotate / disable | NOT TESTED |
| SSRF / HTTPS / no-redirect | TESTED (unit) PASS; production **NOT TESTED** |
| Outbox after commit | IMPLEMENTED; production events **0** |

Missing Coolify `MERCHANT_WEBHOOKS_ORG_ALLOWLIST` keeps outbound closed even after a future deploy. Do not populate it until Stage B webhook canary.

## 16. Background worker

Health: `jobRunner=database`, jobs **Warning**. Webhook-processing path exists in code (`webhook-processing` queue name). **LIVE VERIFIED** of merchant webhook drain: **NO** (zero deliveries).

## 17. Google Sheets / Apps Script

**BLOCKED** — no dedicated spreadsheet or Google OAuth in this operator session. Manual steps: copy [GOOGLE_APPS_SCRIPT_EXAMPLE.md](GOOGLE_APPS_SCRIPT_EXAMPLE.md), store the key in Script Properties (not cells), map columns, `POST /orders` with Idempotency-Key, write back order id; do not call book.

## 18–19. CRM / ERP examples

**NOT TESTED** as live CRM/ERP. Contract is the same REST + webhooks. Prior smoke is the CRM-equivalent create/get/idempotency path. Bulk (`POST /orders/bulk`, max 25) **TESTED** in unit tests; production bulk **NOT TESTED**.

## 20. OpenAPI validation

Unit contract tests included in `npx vitest run modules/merchant-api` — PASS locally. Production `/developers/openapi.json` **404**.

## 21. Automated tests (this run)

| Command | Result |
|---|---|
| `npx vitest run modules/merchant-api modules/webhooks lib/api/v1-permissions.test.ts` | PASS — 15 files, **49** tests |
| `npx tsc --noEmit` | PASS after three type fixes (quickstart JSX, webhook create `url` narrowing in merchant + session handlers) |
| `npx eslint` on those three files | PASS |
| `npx next build` | PASS (exit 0, ~270s). Local routes include `/developers/*`; production origin still 404 until Coolify deploys an isolated SHA. |

## 22. Production smoke (2026-10-19)

Limited to unauthenticated HTTP + Coolify identity + SQL history. Authenticated canary REST: **not repeated**. Live India Post: **not run**.

## 23. Security verification

| Control | Status |
|---|---|
| REST allowlist non-empty (canary only) | PASS |
| Webhook allowlist empty/absent | PASS (deny all) |
| Empty allowlist ≠ open all | PASS (code) |
| Rate RPC not callable as anon | PASS |
| Catch-all 401 without key | PASS |
| `/api/v1` not used as public merchant API | PASS (design) |
| Service-role / HMAC secrets in this report | not printed | PASS |

Bypass review: API handler checks `isMerchantApiOpenForOrg` after key auth; webhooks check `isMerchantWebhooksOpenForOrg` in subscription/delivery services. Dashboard still session-gated. Background publish should no-op when webhook allowlist empty. **LIVE VERIFIED** of dashboard/job bypass: **NOT TESTED** on production this run.

## 24. Known limitations

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md). Bulk cap 25; at-least-once webhooks; no native Zapier/Make/n8n apps.

## 25. Remaining issues / blockers

1. **Do not Coolify-pin current HEAD or the dirty working tree.** Unrelated local changes (affiliates, print agent, env files, etc.) must not ship with the developer platform.
2. Need an **isolated commit** containing only merchant webhook + public `/developers` + related tests/docs, branched from production `fd90212` (or current `release/auth-session-on-prod` after explicit review).
3. Operator must **approve** that pin + `POST /api/v1/deploy?uuid=mw9larpomkyonxzy1rk3h6jm&force=true`.
4. After deploy: set `MERCHANT_WEBHOOKS_ENABLED=true` (or omit) and a **separate** one-org `MERCHANT_WEBHOOKS_ORG_ALLOWLIST`; keep REST allowlist unchanged.
5. Production session login required for Developer Portal key UX.
6. Controlled HTTPS receiver required for signed webhook E2E.
7. Google Sheet E2E requires a dedicated spreadsheet.

## 26. Rollback readiness

**PASS** (procedure exists). Instant REST disable: `MERCHANT_API_ENABLED=false` + restart. Instant webhooks: leave webhook allowlist empty or set `MERCHANT_WEBHOOKS_ENABLED=false`. Do not drop migrations.

## 27. General release readiness

**FAIL.** Criteria not met: public docs 404, webhook app not deployed, portal not live-verified, Sheets/CRM/ERP not live-verified, jobs/shopify/indiaPost health Warning, no isolated deploy SHA.

### Component audit (Phase 1)

| Area | Classification |
|---|---|
| A Merchant REST | IMPLEMENTED, TESTED, production REST **LIVE VERIFIED** (canary, prior smoke) |
| B API authentication | IMPLEMENTED, TESTED, LIVE VERIFIED (401 today + prior HMAC) |
| C API key management | IMPLEMENTED, TESTED; production portal **UNVERIFIED** |
| D Tenant isolation | IMPLEMENTED, TESTED, LIVE VERIFIED (prior smoke) |
| E–I Orders/bulk/book/track/label | IMPLEMENTED, TESTED; booking live **NOT TESTED**; rest prior smoke |
| J–N Webhooks | IMPLEMENTED, TESTED locally; production **UNVERIFIED** / app **MISSING** from SHA |
| O Developer dashboard | IMPLEMENTED; production **UNVERIFIED** |
| P–R Public docs / OpenAPI / examples | IMPLEMENTED locally; production **MISSING** (404) |
| S Feature flags | IMPLEMENTED; REST canary **DEPLOYED**; webhook flags **absent** (closed) |
| T Production deps | encryption + service role **PASS**; worker health **UNVERIFIED** (Warning) |

## Approval gate (explicit)

Production **application** deploy of webhook/docs: **STOPPED**. Migrations: **already applied — no further SQL**. Canary REST: **leave allowlist as-is**. Stage C: **do not enable all merchants**.

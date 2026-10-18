# Isolated production release candidate — Developer Platform v1

**STOP. Explicit operator approval is required before Coolify pin or deploy.**

This report does **not** claim production deployment of this SHA.

## A. Current production SHA

`fd9021236e9c8e136ca20b80a38d1c0621c475a5` on `release/auth-session-on-prod`, app `mw9larpomkyonxzy1rk3h6jm`, `running:healthy`.

## B. Isolated release

| Item | Value |
|---|---|
| Branch | `release/merchant-developer-platform-v1` |
| Base | `fd9021236e9c8e136ca20b80a38d1c0621c475a5` |
| New SHA | recorded after commit (see git log on that branch) |
| Worktree | `.worktrees/merchant-developer-platform-v1` |

## C–D. Files

See [ISOLATED_RELEASE_AUDIT.md](ISOLATED_RELEASE_AUDIT.md). Unrelated dirty-tree features were not copied.

## E. Database migrations

**PASS — already applied.** Do not run `db push` / replay SQL.

## F. Automated tests (isolated worktree)

| Suite | Result |
|---|---|
| `modules/merchant-api` + `modules/webhooks` + `lib/api/v1-permissions.test.ts` | **PASS** 15 files, **49** tests |
| `apply-tracking.test.ts` + `booking-idempotency.test.ts` | **PASS** 2 files, **52** tests |

Vitest was invoked with an ESM config so nested `.worktrees` parent exclude did not skip files. That helper config is **not** part of the release commit.

## G. TypeScript

`npx tsc --noEmit` in the worktree: **PASS**.

Includes quickstart `{id}` string, webhook create `url` narrowing.

## H. Production build

| Check | Result |
|---|---|
| Isolated `npx next build` (Turbopack) | **NOT VERIFIED** — local `node_modules` junction is rejected by Turbopack (`symlink points out of filesystem root`) |
| Isolated `npx next build --webpack` | **FAIL** — pre-existing `node:fs` imports in label unicode code; Coolify uses Turbopack/nixpacks, not this webpack path |
| Dirty-tree `npx next build` (same docs/routes, prior session) | **PASS** with `/developers/*` in the route table |

Coolify `npm install` is a real `node_modules` directory, not a junction. Local junction limitation is **not** a Coolify blocker.

## I. Security review

| Finding | Status |
|---|---|
| HMAC key format / scopes unchanged for REST | PASS |
| Webhook HMAC `timestamp.event_id.rawBody`, header `v1=` | PASS (unit) |
| Empty `MERCHANT_WEBHOOKS_ORG_ALLOWLIST` denies all orgs even if `MERCHANT_WEBHOOKS_ENABLED` is missing/true | PASS (flags tests) |
| SSRF HTTPS, private/loopback/link-local/metadata, no redirects | PASS (unit) |
| Publish after persist + try/catch | PASS (code review) |
| `/api/v1` session auth not rewritten | PASS |
| Secrets in git | none added |
| Worker still `JOB_RUNNER=database` / `webhook-processing` | PASS |

Critical security: **no release blocker** identified in the isolated diff.

## J. Webhook worker readiness

Code path: `workers/processor.ts` `deliverWebhooks` → `runWebhookProcessing`. Production health `jobRunner=database`. jobs **Warning** is pre-existing. Live delivery **NOT VERIFIED** (allowlist empty, 0 outbox rows).

## K. Documentation routes (in candidate)

`/developers`, quickstart, authentication, api-reference, orders, shipments, tracking, webhooks, integrations, build-with-ai, changelog, `openapi.json`, `openapi.yaml`. Production origin still **404** until this SHA is deployed.

## L. Feature flags

Keep Coolify as-is for deploy:

- `MERCHANT_API_ENABLED=true`
- `MERCHANT_API_ORG_ALLOWLIST` = existing one UUID (do not change)
- Do **not** set `MERCHANT_WEBHOOKS_ORG_ALLOWLIST` until a separate webhook canary is approved
- Optional: add `MERCHANT_WEBHOOKS_ENABLED=true` with empty allowlist (same deny-all)

## M. Production health baseline

`GET https://www.postbus.in/api/health`: api/database Healthy; jobs/shopify/indiaPost Warning.

## N. Rollback

Pin Coolify `git_commit_sha` back to `fd90212` and redeploy. Set `MERCHANT_WEBHOOKS_ENABLED=false` if needed. Do not drop migrations.

## O. Known risks

1. Shared publish hooks on order/Shopify/booking/tracking — wrapped try/catch; still extra DB writes when allowlist is empty (outbox short-circuits in `recordWebhookEvent`).
2. Session webhook dashboard now uses SSRF URL checks; invalid private URLs will fail validation (intended).
3. Local isolated Turbopack build could not be reproduced because of the node_modules junction.

## P. Proposed deploy (after approval only)

1. Push `release/merchant-developer-platform-v1` (requires push approval if not already remote).
2. Coolify PATCH application `mw9larpomkyonxzy1rk3h6jm` `git_commit_sha=<isolated SHA>`.
3. Confirm GET application SHA matches.
4. POST `/api/v1/deploy?uuid=mw9larpomkyonxzy1rk3h6jm&force=true`.
5. Wait `finished` + `running:healthy`.
6. Do not replay SQL.
7. Do not fill webhook allowlist in this step.

## Q. Post-deploy verification (after approval)

- `GET /developers` and OpenAPI 200 with real docs JSON/YAML
- `GET /api/merchant/v1/me` 401 without key
- Canary REST `/me` with existing key (no live book)
- Health unchanged or improved
- Webhook routes 401 without key (handlers present)

## R. Recommendation

**READY FOR OPERATOR APPROVAL TO DEPLOY THE ISOLATED SHA.**

**NOT READY** for webhook canary, Google Sheets E2E, or general merchant enablement.

Do not treat this document as a completed production rollout.

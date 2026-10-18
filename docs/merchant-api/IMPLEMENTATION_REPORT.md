# Merchant Public API v1 — implementation report

## SECTION A — What existed before

Session auth, org membership, RBAC (`api_keys.manage` for OWNER/ADMIN), unused `api_keys` table (`pb_live_` + SHA-256), `createManualOrder` / booking / tracking / labels services, in-memory rate limits, `idempotency_keys` for WhatsApp, session `/api/v1` dispatcher.

## SECTION B — What was created

- `docs/merchant-api/PHASE-0-AUDIT.md` and this folder’s contract docs
- Migration `20261018180000_merchant_public_api.sql`
- `modules/merchant-api/*`
- `app/api/merchant/v1/[...slug]/route.ts`
- Developer Portal `app/dashboard/integrations/developer/page.tsx`
- Vitest coverage for keys, auth, handle, idempotency, booking enqueue, logs

## SECTION C — What was modified

- `lib/api/v1-schemas.ts` API key create now requires scopes
- `lib/api/v1/workspace.ts` HMAC mint, rotate, revoke timestamp, usage/docs
- `lib/api/v1-permissions.ts` `merchant-api` → `api_keys.manage`
- Integrations index card linking to the portal

`handleV1` is still session-only.

## SECTION D — Migrations

`supabase/migrations/20261018180000_merchant_public_api.sql` — additive. **Not applied to production by this workstream.**

## SECTION E — Merchant endpoints

All under `/api/merchant/v1`: `GET /me`, `GET /meta/schema`, `POST /orders`, `POST /orders/bulk`, `GET /orders`, `GET /orders/{id}`, `PATCH /orders/{id}`, `POST /orders/{id}/book`, `GET /shipments`, `GET /shipments/{id}`, `GET /shipments/{id}/tracking`, `GET /shipments/{id}/label`.

## SECTION F — Security

HMAC-SHA256 keyed with `INTEGRATION_ENCRYPTION_KEY`, lookup_id, scopes, org from key only, service-role queries always filtered by that org, no request PII in logs, booking not on create, `runBookingNow: false`.

## SECTION G — Authentication

`Authorization: Bearer pb_live_<lookup>_<secret>`. Legacy SHA-256 keys are rejected.

## SECTION H — Tenant isolation

Organization id is taken from the API key row after HMAC verify. Resource queries use `.eq("organization_id", ctx.organizationId)`. Cross-tenant ids return `RESOURCE_NOT_FOUND`.

## SECTION I — Google Apps Script

Merchants run the documented script in their Google account. Mapping lives in `COLUMN_MAP`. Keys live in Script Properties.

## SECTION J — ChatGPT / Gemini

Copy the Developer Portal prompt plus downloaded OpenAPI/reference. Do not paste API keys into the model.

## SECTION K — Tests

See the Vitest run recorded with this change. Only tests that executed and passed are claimed.

## SECTION L — Unverified

Production migration, live CEPT booking via Merchant API, multi-instance rate-limit soak, logged-in browser walkthrough if no session was available.

## SECTION M — Before production

Staging migration + verification checklist, explicit approval, then production migrate and deploy. See `STAGING_VERIFICATION.md` and `PRODUCTION_DEPLOYMENT.md`.

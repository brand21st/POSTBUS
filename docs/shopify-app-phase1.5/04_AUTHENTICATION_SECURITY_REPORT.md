# 04 Authentication security report

**Scope:** ID token, token exchange, bootstrap org id, logging.

**Classification:** PASS for local cryptographic tests. BLOCKED for live token exchange against Shopify.

## Evidence

- [`lib/shopify-app/id-token.ts`](../../lib/shopify-app/id-token.ts): HS256, public secret only, `aud` = public client id, `iss`/`dest` host match, shop from dest.
- Stale JWT: `401` + `X-Shopify-Retry-Invalid-Session-Request`.
- Client `organization_id` rejected (`assertOrganizationMatch`).
- Exchange/refresh tokens encrypted via `encryptSecret`; not returned in bootstrap JSON.
- Exchange HTTP failure throws `AUTH_UNAVAILABLE` (mocked 400). In-process refresh lock serializes same-shop work.
- Exchange failure on bootstrap sets `REAUTH_REQUIRED` and UI `authorization_required`; org id is still present for display (not treated as Admin-API-ready).

## Tests performed (actual)

Vitest ID token + token-exchange files: PASS (see suite total in 09).

Live Shopify OAuth/token exchange: NOT TESTED.

## Residual risk

In-memory refresh lock does not span multiple Node processes. Multi-instance production would need a DB/advisory lock. Documented; not implemented (no production).

## Recommendations

Stage D: exchange against a development shop only. Never log access tokens.

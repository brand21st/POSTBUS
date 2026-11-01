# 01 Dev app identity verification

**Classification:** PASS for local public-app keys in gitignored env. FAIL until Partner Dashboard confirms this app has no production installs. BLOCKED for CLI link. **Rotate the client secret** — it was pasted into chat.

## Scope

Identify the existing Partner app without creating a second app. Client secret was not printed.

## Evidence (2026-10-20)

| Item | Observed |
|------|----------|
| [`shopify.app.toml`](../../shopify.app.toml) `name` | `PostBus` |
| toml `client_id` | `REPLACE_WITH_PARTNER_APP_CLIENT_ID` (placeholder) |
| toml `application_url` | `http://localhost:3000/shopify` |
| toml `embedded` | `true` |
| toml `automatically_update_urls_on_dev` | `false` |
| `.env.local` `SHOPIFY_PUBLIC_APP_CLIENT_ID` | set (masked `a9d1…5b10`, length 32); **secret was pasted in chat — rotate in Partner Dashboard** |
| `.env.local` `SHOPIFY_PUBLIC_APP_CLIENT_SECRET` | present (not logged); not written to toml |
| `.env.local` `SHOPIFY_EMBEDDED_APP_ENABLED` | `false` (must stay false while Supabase URL is production) |
| Dev Dashboard live listing / install count | NOT TESTED (no CLI link, no API) |

Masked preflight via `npx tsx scripts/stage-d-env-preflight.mts` (values never logged).

## Expected

Gitignored `.env.local` holds the **existing** app’s public client ID and secret. Toml may stay placeholder until an approved uncommitted URL/client_id update.

## Actual vs expected

Public-app keys are in `.env.local` (not BYO `SHOPIFY_API_*`). Toml `client_id` is still the placeholder. Live merchant-install count is unknown.

## Blockers

1. Rotate the pasted client secret in Partner Dashboard, then update `.env.local` only.
2. Confirm this app has **no production merchant installs** before any config mutation.
3. Do not enable `SHOPIFY_EMBEDDED_APP_ENABLED` while Supabase URL is production.

## Recommendations

Do not run `shopify app config link` until the client ID in `.env.local` is set and you confirm the app is the intended development identity.

# 19 Final cloud-dev migration readiness

**Date:** 2026-10-20  
**Verdict:** **NOT READY to authorize `db push`.** No hosted SQL. Production not written.

## Encryption configuration

Shopify offline tokens are AES-256-GCM via `encryptSecret` / `encryptTokenSet` in `lib/security/crypto.ts` and `lib/shopify-app/token-exchange.ts`. Env var: **`INTEGRATION_ENCRYPTION_KEY`**. Missing key uses a hardcoded fallback (unsafe for shared tokens).

| Item | Status |
|------|--------|
| Overlay key | **Generated** into gitignored `.env.shopify-local` (64 hex chars). Value not logged. |
| Gate | Requires 32+ chars and rejects the code fallback |
| Runner blocklist | `INTEGRATION_ENCRYPTION_KEY` is stripped from parent env so `.env.local` production key cannot win |
| Production `.env.local` key | Still present (length 44); unused by `dev:shopify` after blocklist |

## Secret rotation

Matching the shopify-dev project ref is **not** treated as rotation.

| Item | Status |
|------|--------|
| Overlay service key | **legacy JWT**, `ref=faanzcrnfndttbjpmlxu`, `role=service_role` |
| Same `iat` as chat-exposed JWT (`1792474101`) | **YES** — still the exposed token |
| REST probe to shopify-dev only | **HTTP 200**, JWT **still accepted** |
| Revoked? | **NO** |
| `sb_secret_` configured | **NO** (SDK 2.116 **does** support `sb_secret_` / `sb_publishable_`) |
| Overlay vs production fingerprint | Different (production JWT is not in overlay) |
| Partner `shpss_` pasted in chat | Treat as **still exposed** until you rotate in Shopify Admin and update overlay |

## Development environment

| Item | Status |
|------|--------|
| Gate | **PASS** `faanzcrnfndttbjpmlxu` |
| `JOB_RUNNER` | **none** (forced on runner) |
| Flag | **false** |
| BYO `SHOPIFY_API_KEY`/`SECRET` | empty |
| Port / app URL | 3002 / `http://localhost:3002` |
| `.env.local` | production ref + `JOB_RUNNER=database` — do not use `npm run dev` |
| Runner isolation | Overlay assigned after deleting production URL/key blocklist |

## Supabase CLI

| Item | Status |
|------|--------|
| Linked project | **`hgacoeoovjxkzfbesmvl` (POSTBUS) `linked: true`** |
| `faanzcrnfndttbjpmlxu` in `projects list` | **ABSENT** for this CLI token |
| Docker | unused |

Prepared (do **not** run until the token can see shopify-dev and JWT is replaced):

```powershell
npx supabase unlink
npx supabase link --project-ref faanzcrnfndttbjpmlxu
npx supabase projects list
# linked must be faanzcrnfndttbjpmlxu only
```

Never `db push` while production is linked. Never `db reset` remote.

## Migration chain

130 timestamped files in `supabase/migrations/`, last `20261020120000_shopify_public_app_foundation.sql`. Empty shopify-dev needs the **full** chain. No `DROP TABLE`/`TRUNCATE`. No production ref in SQL.

## Tests (non-destructive)

`lib/env/shopify-dev-isolation.test.ts` + `lib/security/crypto.test.ts`: **7 passed**. Gate: `write: false`, `migrate: false`.

## Blockers before approval

1. Rotate/revoke the **chat-exposed shopify-dev JWT** (still valid). Prefer new `sb_secret_` in overlay.  
2. Rotate Partner client secret; keep BYO Shopify vars empty.  
3. CLI must **unlink production** and **link** `faanzcrnfndttbjpmlxu` (project must appear in `projects list`).  
4. Re-run `npx tsx scripts/shopify-cloud-dev-preflight.mts` until `chatExposedDevJwtStillInOverlay` is false and probe is not “accepted exposed JWT”.

## Approval checkpoint

Authorize **`npx supabase db push` only against `faanzcrnfndttbjpmlxu`** after blockers 1–4. Until then: **no hosted database mutation.**

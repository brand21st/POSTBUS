# 18 Shopify cloud-dev preflight (`faanzcrnfndttbjpmlxu`)

**Date:** 2026-10-20  
**Classification:** **BLOCKED** for hosted migration. Read-only. **No SQL applied.** Production `hgacoeoovjxkzfbesmvl` was not written.

## Verdict

Do **not** authorize `supabase db push` yet.

| Check | Result |
|-------|--------|
| Declared shopify-dev ref | `faanzcrnfndttbjpmlxu` |
| Host `https://faanzcrnfndttbjpmlxu.supabase.co` | Responds (Auth `/auth/v1/health` **401** without apikey — host exists) |
| `.env.shopify-local` | **MISSING** |
| Replacement server secret configured | **NO** |
| Compromised production JWT retired | **UNVERIFIED** — `.env.local` still has a **legacy JWT** whose `ref` claim is production |
| `sb_secret_` support in `@supabase/supabase-js@2.116` | **YES** (`apikey` header, not Bearer) |
| Fail-closed gate | **PASS** (refuses start without overlay; does not fall back to production) |
| `JOB_RUNNER=none` on overlay | N/A (overlay missing); isolation requires it |
| `.env.local` jobs | `JOB_RUNNER=database` against **production** — do not run `npm run dev` / workers / `jobs:drain` for this work |
| Embedded flag | **false** on `.env.local` |
| CLI `projects list` `linked` | **`hgacoeoovjxkzfbesmvl` (POSTBUS) `linked: true`** |
| `faanzcrnfndttbjpmlxu` in CLI project list | **NOT PRESENT** (token/org cannot see it, or project is not in this account) |
| Docker | Not used (`status` fails: docker missing) |

## Security incident (legacy `service_role` JWT)

This machine **cannot** prove the leaked JWT was revoked in the production dashboard. Doing so would require using the leaked credential against production Auth, which is forbidden.

Facts without printing secrets:

- Overlay does not exist, so it does **not** currently hold the leaked JWT.
- `.env.local` `SUPABASE_SERVICE_ROLE_KEY` is a **legacy JWT** (`eyJ…`) with JWT `ref` = **production**. Fingerprint prefix `3b6f4db4a7ee` (SHA-256, 12 hex) — not the secret itself.
- New-format `sb_secret_` keys **are** supported by the installed SDK. Prefer those for shopify-dev. Do not put a production JWT into `.env.shopify-local`.

**BLOCKED** until you confirm in the Supabase dashboard that the leaked production JWT is disabled/rotated **and** `.env.shopify-local` contains **only** `faanzcrnfndttbjpmlxu` keys (`sb_secret_` or a JWT whose `ref` is `faanzcrnfndttbjpmlxu`).

## Environment

Copy [`.env.shopify-local.example`](../../.env.shopify-local.example) → `.env.shopify-local`, then paste **shopify-dev** anon + secret keys locally. Example already names:

- `POSTBUS_SHOPIFY_DEV_PROJECT_REF=faanzcrnfndttbjpmlxu`
- `NEXT_PUBLIC_SUPABASE_URL=https://faanzcrnfndttbjpmlxu.supabase.co`
- `JOB_RUNNER=none`
- `SHOPIFY_EMBEDDED_APP_ENABLED=false`
- empty BYO Shopify / Razorpay

Start only with `npm run shopify:dev-gate` then `npm run dev:shopify` (port **3002**). Never `npm run dev` for App Home.

## Migrations (130 files, timestamp order)

First / last:

1. `20260919090000_init_enums_identity.sql` — orgs, `set_updated_at()`, enums, pgcrypto  
2. `20260919090100_commerce_shipping.sql`  
3. `20260919090200_integrations_platform.sql` — `automation_settings`, `india_post_connections`, `background_jobs`  
4. … remaining SaaS chain …  
5. `20261020120000_shopify_public_app_foundation.sql` — **must run last among current files**

**Required for a bootable Next + Shopify BFF on an empty project: the full chain**, not three files. Later migrations add columns/RPCs (`claim_background_jobs`, billing, unique shop constraints, RLS helpers) that other modules import at boot.

**Shopify-specific minimum (subset, not recommended as the only apply):**

- Identity + integrations + `20261020120000_shopify_public_app_foundation.sql`

**Provisioning SQL:** `provision_shopify_app_organization(shop, app_client_id, name)` — security definer, `search_path=public`, execute **service_role only**, revoke anon/authenticated. Inserts org `origin=SHOPIFY_PUBLIC_APP`, `automation_settings`, install `PENDING`. Unique `(app_client_id, shop_domain)` and unique `shop_domain`. `on delete restrict` on org FK.

**RLS:** install/compliance/webhook tables enable RLS, revoke all from anon/authenticated, grant all to service_role. No permissive policies for those tables (service_role bypasses RLS).

**Destructive scan:** no `DROP TABLE` / `TRUNCATE`. `DELETE` appears in data-maintenance RPCs (tracking events, affiliate retention, storefront bundles) — not wipe-production. `india_post_connections.environment` default becomes `PRODUCTION` in `20260930183000_…` (enum, not the hosted project). **No migration file contains `hgacoeoovjxkzfbesmvl`.**

## Exact execution commands (do **not** run until unblocked + authorized)

CLI is currently linked to **production**. Sequence after overlay + rotation + CLI can see shopify-dev:

```powershell
npx tsx scripts/shopify-cloud-dev-preflight.mts
npx tsx scripts/dev-shopify.mts --gate
npx supabase projects list
# Confirm faanzcrnfndttbjpmlxu is listed and linked:false on production.
npx supabase unlink
npx supabase link --project-ref faanzcrnfndttbjpmlxu
npx supabase projects list
# Confirm linked:true is faanzcrnfndttbjpmlxu ONLY, never hgacoeoovjxkzfbesmvl
npx supabase db push
```

Never `supabase db reset` on a remote. Never `db push` while production is linked.

## Expected database changes (after a future approved push)

Empty shopify-dev Postgres receives the full public schema: organizations through Shopify install tables, RPCs, RLS. **No production rows copied.** No `tuzzstore` install until a later approval.

## Rollback

Hosted first push onto an **empty** project: rollback = do not use the project; optionally `db dump` was never taken. Do **not** reset production. Do **not** re-link production to apply a reverse migration. If push partially fails, stop and inspect `supabase_migrations.schema_migrations` on **shopify-dev only**.

## Validation tests (local, already run / available)

```powershell
npx vitest run lib/env/shopify-dev-isolation.test.ts
npx tsx scripts/shopify-cloud-dev-preflight.mts
npx tsx scripts/dev-shopify.mts --gate
```

Post-migrate (future): confirm tables `shopify_app_installations` and function `provision_shopify_app_organization` on **faanzcrnfndttbjpmlxu** only.

## Remaining blockers (must clear before you authorize push)

1. Confirm leaked production JWT revoked in dashboard (this preflight cannot).  
2. Create `.env.shopify-local` with **shopify-dev** keys only (`sb_secret_` preferred).  
3. Gate must print `projectRef: faanzcrnfndttbjpmlxu` and `write: false`.  
4. CLI must **unlink production** and **link** `faanzcrnfndttbjpmlxu` (project must appear in `projects list` for this token).  
5. Keep `SHOPIFY_EMBEDDED_APP_ENABLED=false`. No tunnel, install, or `shopify app deploy`.

## Authorization checkpoint

Reply with: **approve db push to `faanzcrnfndttbjpmlxu` only** after blockers 1–4 are true. Until then, **no hosted write.**

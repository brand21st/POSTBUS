# 17 Cloud development database setup (`postbus-shopify-dev`)

**Date:** 2026-10-20  
**Status:** PLAN READY. **NO hosted SQL was executed.** Production project `hgacoeoovjxkzfbesmvl` was not written.

Docker is **not** used. The isolated target is a new hosted Supabase project named **`postbus-shopify-dev`**. You create that project in the Supabase dashboard and paste its ref/keys into gitignored `.env.shopify-local`.

## Fail-closed runtime

| Path | Database target |
|------|-----------------|
| `npm run dev` | Still loads `.env.local` (currently production). **Do not use this for Shopify App Home.** |
| `npm run dev:shopify` | Loads `.env.shopify-local` only after a gate. Overlay keys **replace** parent production URLs/keys. Port **3002**. |
| `npm run shopify:dev-gate` | Validates overlay; does **not** start Next; does **not** migrate. |

`POSTBUS_SHOPIFY_DEV=true` also asserts inside `lib/env.ts` and `createAdminClient()`. `JOB_RUNNER=none` disables `drainDueJobs` and BullMQ `npm run workers`.

Production ref **`hgacoeoovjxkzfbesmvl` is always refused** by the Shopify overlay.

## Required environment variables

Copy [`.env.shopify-local.example`](../../.env.shopify-local.example) → `.env.shopify-local` (gitignored).

| Variable | Rule |
|----------|------|
| `POSTBUS_SHOPIFY_DEV` | `true` |
| `POSTBUS_SHOPIFY_DEV_PROJECT_REF` | Hosted ref of **postbus-shopify-dev**, never production |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<that-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon JWT from that project only |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role JWT from that project only |
| `INTEGRATION_ENCRYPTION_KEY` | Dev-only secret; do not reuse production |
| `JOB_RUNNER` | `none` |
| `SHOPIFY_EMBEDDED_APP_ENABLED` | `false` |
| `SHOPIFY_PUBLIC_APP_CLIENT_ID` / `SECRET` | Partner public app (not BYO `SHOPIFY_API_KEY`) |
| `SHOPIFY_API_KEY` / `SECRET` | Empty |
| `RAZORPAY_*` / `VACHAT_API_KEY` | Empty (live Razorpay refused) |
| `PORT` / `NEXT_PUBLIC_APP_URL` | `3002` / `http://localhost:3002` |

Do not commit keys. Do not paste them in chat.

## Database schema dependencies

Shopify App Home provision + bootstrap need:

| Object | Source |
|--------|--------|
| `pgcrypto`, enums, `set_updated_at()`, `organizations`, `profiles`, `organization_members` | `20260919090000_init_enums_identity.sql` |
| `automation_settings`, `india_post_connections` (bootstrap read), `background_jobs` | `20260919090200_integrations_platform.sql` |
| `organizations.origin`, `shopify_app_installations`, compliance + webhook tables, RLS deny anon/authenticated, **`provision_shopify_app_organization`** (service_role only) | `20261020120000_shopify_public_app_foundation.sql` |

RPC inserts `organizations` (`origin = SHOPIFY_PUBLIC_APP`, `created_by` null) and `automation_settings`, then `shopify_app_installations` status `PENDING`. Unique `(app_client_id, shop_domain)` and unique `shop_domain`.

Tenant BFF uses **service role** with `eq("organization_id", org)` (or `id` for `organizations`). It **denies** `shopify_connections` and **denies** `rpc()` from the tenant wrapper. App tables revoke anon/authenticated.

**Recommended hosted apply (after approval only):** the full `supabase/migrations/` chain (~130 files) onto an **empty** `postbus-shopify-dev` so the rest of Next (health `billing_plans`, RLS helpers, later Shopify unique constraints) exists. Do **not** cherry-pick three files on a project you later `db push` without reviewing history.

**Do not** copy production rows. Seed only synthetic data (see fixtures below).

## CLI / production isolation

`npx supabase status` has been seen **linked** to production `hgacoeoovjxkzfbesmvl`. Until you:

1. Confirm dashboard project **postbus-shopify-dev** exists and is **not** that ref  
2. `npx supabase unlink` locally (or link **only** to the new project after you have the new ref)  

**never** run `supabase db push`, `db reset`, or dump/restore against the linked remote.

`db reset` against a remote project is forbidden even for shopify-dev.

## Migration execution plan (STOPPED — needs approval)

1. Create hosted project **postbus-shopify-dev**. Record its ref in `.env.shopify-local`.  
2. `npm run shopify:dev-gate` must print `write: false` and a **non-production** `projectRef`.  
3. Confirm CLI `linked_project` equals that ref, **not** `hgacoeoovjxkzfbesmvl`.  
4. **STOP here until you explicitly approve hosted writes.**  
5. After approval: `npx supabase db push` **only** while linked to postbus-shopify-dev.  
6. Confirm tables `shopify_app_installations` and function `provision_shopify_app_organization`.  
7. Optional synthetic seed from [`fixtures/shopify-dev-seed.example.sql`](fixtures/shopify-dev-seed.example.sql) — still not production shops/customers.  
8. `npm run dev:shopify` (flag still false).  
9. Separate later approvals: flag-on, tunnel, `tuzzstore.myshopify.com` install, `shopify app deploy`.

## Isolated fixtures (not applied)

Do not import production orgs, orders, CEPT tokens, or live Shopify tokens. After migrate approval, optional seed creates a fake `*.myshopify.com` org **or** wait for provision RPC on first App Home session.

`tuzzstore.myshopify.com` must **not** be inserted until you intend a real install against the **dev** project.

## Existing PostBus SaaS

Unchanged: production Coolify/web, production Supabase, `.env.local`, `npm run dev` on port 3000. Shopify overlay does not modify those files. Feature flag remains **false**. No Shopify Partner deploy.

## Security checklist

- [x] No production SQL executed this session  
- [x] No `db push` / `db reset`  
- [x] Overlay refuses production ref and parent production URLs  
- [x] Jobs isolated (`JOB_RUNNER=none`, workers refuse shopify-dev)  
- [x] Embedded flag forced false in overlay  
- [x] BYO HMAC keys refused in overlay  
- [ ] You created **postbus-shopify-dev** and filled `.env.shopify-local`  
- [ ] CLI unlinked from production / linked only to shopify-dev  
- [ ] Service-role JWT is from shopify-dev only  
- [ ] Partner secret that was pasted in chat is rotated  

## Verification commands (read-only)

```powershell
npx vitest run lib/env/shopify-dev-isolation.test.ts
npx tsx scripts/dev-shopify.mts --gate
npx tsx scripts/stage-d-env-preflight.mts
npx supabase --version
npx supabase projects list
```

`stage-d-env-preflight` still describes **`.env.local`** (production). Gate is the overlay.

Expected gate failures until credentials exist: missing `.env.shopify-local`, missing `POSTBUS_SHOPIFY_DEV_PROJECT_REF`, or production URL.

## Remaining blockers

1. Hosted project **postbus-shopify-dev** must be created by you (this agent did not create it).  
2. Overlay file not filled (secrets stay local).  
3. Supabase CLI may still be linked to production — do not push.  
4. Foundation SQL not applied anywhere hosted.  
5. Docker remains unused.  
6. App Home / store install / flag / tunnel not approved.

## Exact approval checkpoint

Reply with **explicit approval to apply migrations to hosted `postbus-shopify-dev`** (include the **project ref** you filled, not production). Until then: **no hosted database write, no seed, no `db push`.**

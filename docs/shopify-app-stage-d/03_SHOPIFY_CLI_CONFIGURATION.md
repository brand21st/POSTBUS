# 03 Shopify CLI configuration

**Classification:** PASS for inspection. BLOCKED for `app dev` / `config link` / `deploy`.

## CLI

Previously inspected: Shopify CLI **3.90.0** (`shopify version` only). This preflight did **not** re-run mutating commands.

## Project files

- [`shopify.app.toml`](../../shopify.app.toml) — embedded Next app, placeholder client_id, HTTP localhost URLs
- [`shopify.web.toml`](../../shopify.web.toml) — `dev = "npm run dev"` (no Remix scaffold)

## BYO env collision (critical)

Shopify CLI `shopify app dev` commonly injects `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` into the web process.

PostBus already maps those names to the **BYO connector** in [`lib/env.ts`](../../lib/env.ts) (`shopifyApiKey` / `shopifyApiSecret`). The public embedded app must use **only**:

- `SHOPIFY_PUBLIC_APP_CLIENT_ID`
- `SHOPIFY_PUBLIC_APP_CLIENT_SECRET`

## Isolation strategy (do not execute until approved)

**Preferred:** `npm run dev` + Cloudflare Tunnel to `localhost:3000`. Do not use `shopify app dev` as the process supervisor.

**If CLI preview is later approved:** a wrapper must `unset` / ignore CLI `SHOPIFY_API_KEY` and `SHOPIFY_API_SECRET` so they cannot override BYO or leak into public-app HMAC. Keep `[build] automatically_update_urls_on_dev = false`.

## Forbidden until extra approval

```
shopify app dev
shopify app deploy
shopify app config link
shopify app config link --reset
```

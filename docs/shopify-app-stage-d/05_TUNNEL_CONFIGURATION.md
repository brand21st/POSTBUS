# 05 Tunnel configuration

**Classification:** BLOCKED. No tunnel created.

## Options

| Option | Verdict |
|--------|---------|
| A Shopify CLI tunnel via `shopify app dev` | Rejected as default — injects `SHOPIFY_API_KEY` |
| B Cloudflare Tunnel to `localhost:3000` | Preferred after approval |
| C Existing HTTPS non-production host | None named; not `www.postbus.in` |

## Required properties (when approved)

- HTTPS
- Path `/shopify` and `/api/shopify/*` reachable
- Webhooks `https://<host>/api/shopify/webhooks`
- Do not publish `/admin` as the app URL
- Do not change production DNS

## Current

No public hostname. `NEXT_PUBLIC_APP_URL` is `http://localhost:3000`. Shopify Admin cannot iframe HTTP localhost without a tunnel/HTTPS host.

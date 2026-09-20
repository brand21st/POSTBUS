# Hostinger VPS runbook

Postgres stays on Supabase (`https://hgacoeoovjxkzfbesmvl.supabase.co`). Do not install a second PostgreSQL on the VPS.

## Keep vachat.in separate

`vachat.in` and `www.vachat.in` are a different project. Do not change their nameservers, Cloudflare proxy, or `@` / `www` DNS records. PostBus must never be served on those hosts.

## Temporary PostBus hosts (until postbus.in)

Use only these names, all pointing at VPS `89.116.34.166`:

| Type | Name in Cloudflare | Hostname | Proxy |
| --- | --- | --- | --- |
| A | `postbus` | `postbus.vachat.in` | DNS only (grey cloud) |
| A | `www.postbus` | `www.postbus.vachat.in` | DNS only |
| A | `*.postbus` | `*.postbus.vachat.in` | DNS only |

Add those three records in **Cloudflare** → `vachat.in` → DNS. Hostinger’s zone is not public because Cloudflare is the nameserver.

In Coolify, attach the same three hosts to the **PostBus** app only. Do not add `vachat.in` or `www.vachat.in` there.

Set `NEXT_PUBLIC_APP_URL=https://postbus.vachat.in` and Supabase Auth redirect URLs to `https://postbus.vachat.in/auth/callback`. Switch to `postbus.in` when that domain is connected.

## Services on the VPS

- Nginx reverse proxy
- Next.js (`npm run start`)
- Redis
- BullMQ workers (`npm run workers`)

## Deploy

1. Clone the repo to `/var/www/postbus`
2. Copy production env (never commit secrets). `INTEGRATION_ENCRYPTION_KEY` must be set; the app will not encrypt integration secrets in production without it.
3. Apply pending files in `supabase/migrations/` to the remote Supabase project
4. `npm ci && npm run build`
5. Install Redis and enable `infra/postbus-web.service` + `infra/postbus-workers.service`. `npm run workers` needs `tsx`, which is a production dependency.
6. Use `infra/nginx.conf.example` (`server_name` includes `*.postbus.in` and `*.postbus.vachat.in`)
7. Set Supabase Auth redirect URLs to `https://postbus.vachat.in/auth/callback` (or `https://postbus.in/auth/callback` after cutover) and Shopify callback to the matching `/api/v1/integrations/shopify/callback` URL

## Wildcard tracking hosts

Merchant tracking pages are served on `{subdomain}.postbus.vachat.in` now, and `{subdomain}.postbus.in` after cutover (rewritten to `/track`). Do not add a second Postgres instance.

The wildcard record name in Cloudflare is `*.postbus` (not `*`). For `postbus.in` later:

1. In Hostinger DNS, add a wildcard `A` record: `*` → the VPS public IP (keep apex/`www` as they are).
2. Issue a wildcard TLS certificate with DNS-01 (HTTP-01 cannot prove a wildcard).
3. Reload Nginx after the certificate is installed. `proxy_set_header Host $host` must stay so Next.js can read the merchant subdomain.

## Local development

Chrome and Edge resolve `*.localhost`. Visit `http://priya-stores.localhost:3000` while `npm run dev` is running.

If a machine does not resolve `*.localhost`, add a hosts entry:

```
127.0.0.1 priya-stores.localhost
```

Do not use `localhost:3000` for the customer page — that host stays the marketing site and merchant dashboard.

## Release notes for operators

- Recreate outgoing workspace webhook endpoints after deploy so they receive a recoverable signing secret. Existing endpoints keep delivering, but `X-PostBus-Signature` is omitted until they are rotated (`needsSecretRotation` on `GET /api/v1/webhooks`).
- India Post inbound webhooks still authenticate only by connection UUID in the URL. Do not treat that as a completed signing contract.
- `npm ci --omit=dev` is safe for workers because `tsx` is in `dependencies`.

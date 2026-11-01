# 02 Development environment

**Classification:** FAIL for Stage D database isolation and local Supabase (Docker missing). PASS that the Shopify flag stays off.

## Observed `.env.local` (masked)

| Variable | Status |
|----------|--------|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` |
| `SHOPIFY_EMBEDDED_APP_ENABLED` | false (not enabled) |
| `SHOPIFY_PUBLIC_APP_*` | client ID set (masked); secret present; flag still false |
| `NEXT_PUBLIC_SUPABASE_URL` host | `hgacoeoovjxkzfbesmvl.supabase.co` |
| Project ref | `hgacoeoovjxkzfbesmvl` (**production**, forbidden) |
| Loopback | false |
| BYO `SHOPIFY_API_KEY` / `SECRET` | not present in this file |

## Local HTTP (flag off, expected)

```
shopify:404
bootstrap:404
dashboard:307
```

`/shopify` 404 is correct while the flag is false ([`app/shopify/layout.tsx`](../../app/shopify/layout.tsx) `notFound()`).

## Required before any install

Local-only (gitignored) values, names already in [`lib/env.ts`](../../lib/env.ts):

- `SHOPIFY_EMBEDDED_APP_ENABLED=true` (**local only**)
- `SHOPIFY_PUBLIC_APP_CLIENT_ID`
- `SHOPIFY_PUBLIC_APP_CLIENT_SECRET`
- `SHOPIFY_PUBLIC_APP_API_VERSION=2026-04` (optional; default exists)
- `NEXT_PUBLIC_SUPABASE_URL` must be loopback (`http://127.0.0.1:54321`), **not** production
- Matching local anon + service role keys

Never set the production flag. Never put secrets in `shopify.app.toml` or the chat.

## Local stack (2026-10-20)

Docker is **not** installed on PATH. `npx supabase start` was **not** run. See [16_LOCAL_SUPABASE_READINESS.md](16_LOCAL_SUPABASE_READINESS.md).

`JOB_RUNNER=database` + production `NEXT_PUBLIC_SUPABASE_URL` means `npm run dev` can write jobs to production. Keep the embedded flag off. Do not run `npm run workers` until the URL is loopback.

Template for a future isolated overlay: [`.env.shopify-local.example`](../../.env.shopify-local.example).

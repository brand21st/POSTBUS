# PostBus final authenticated E2E

Date: 2026-10-31  
App: `http://127.0.0.1:3001`  
Auth: local GoTrue `127.0.0.1:54321`  
User: synthetic `@postbus.invalid` (Organization A). Password not recorded here.

## Preflight

| Check | Result |
| --- | --- |
| GoTrue `/auth/v1/health` | 200 |
| Staging runtime | `postbusEnv=staging`, supabase `127.0.0.1:54321`, CEPT `127.0.0.1:4099` STUB, Shopify keys empty, Razorpay false |
| Containers | db/auth/kong/rest/storage/inbucket/pg_meta up ~8 minutes, healthy |
| Volume | `postbuslocal` kept |

**STAGING PREFLIGHT: PASS**

## Browser (Cursor browser, real clicks)

| Step | Result |
| --- | --- |
| `/login` form | Rendered |
| Password sign-in | Landed on `/dashboard` |
| Organization context | **Staging Org A** |
| Dashboard KPIs | Loaded, zeros, no redirect to login |
| India Post connect dialog | Opened; Close dismissed it |
| `/dashboard/orders` first paint | Shell only until hydration |
| Reload `/dashboard/orders` | Session kept. Empty state: All Orders 0, “No orders match these filters”, Add order visible |
| Invalid password | **Not executed** this pass |
| Logout | **Not executed** |
| Address review / booking / labels / settings / support | **Not executed** |
| Org B browser navigation | **Not executed** (API RLS 25/25 earlier) |

Server log during dashboard: `GET /api/v1/orders` 200. Also `shopify.line-item-images.backfill` and `tracking_page.provision_failed` with `permission denied`. Immediate re-check: `authenticated` **has** SELECT on `shopify_connections`, `tracking_pages`, and `orders`. Treat as a background provision error on an empty org, not a failed login.

## Verdict

**BROWSER LOGIN + DASHBOARD + ORDERS LIST: PASS (limited)**  
**FULL BROWSER E2E (address, booking, labels, logout, cross-tenant UI): NOT COMPLETE**

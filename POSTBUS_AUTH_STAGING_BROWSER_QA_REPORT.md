# POSTBUS AUTH STAGING BROWSER QA REPORT

**Date:** 2026-10-14  
**Phase:** 2.7  
**Code SHA:** `cd697ba3528f8c07281d4db836c49a430eef166a` (docs HEAD) / auth code `ab8690e8a3f753b828910df91b70506b6106d00b`  
**Production Supabase:** `hgacoeoovjxkzfbesmvl` — **not written**  
**Production Coolify:** **not deployed**

---

## 1. Environment identity

| Item | Verified value | Isolated? |
|---|---|---|
| Git branch | `fix/auth-session-stability` @ `cd697ba` | n/a |
| Connected Supabase MCP | `https://hgacoeoovjxkzfbesmvl.supabase.co` | **NO — production** |
| Supabase development branches | **none** (`list_branches` = `[]`) | n/a |
| `.env.local` Auth URL | `https://hgacoeoovjxkzfbesmvl.supabase.co` | **NO — production** |
| `.env.staging` | Local Postgres/CEPT only (`STAGING_NAME=postbus-staging-local`). **No** `NEXT_PUBLIC_SUPABASE_URL` | DB-only, **not Auth** |
| Repo staging scripts | `npm run staging:up` → local Postgres 127.0.0.1:55432 + CEPT stub. Denylist includes `hgacoeoovjxkzfbesmvl` | India Post worker staging, **not GoTrue** |
| Local `supabase/config.toml` | `project_id = POST_BUS_APP`, `jwt_expiry = 3600`, `refresh_token_reuse_interval = 10` | Local stack **not started** this phase |
| Coolify UUID file | `0efdidjjgztsyqrymxdgyyut` | Treated as **production app**; not used |
| Hostinger VPS | `id=1944548` `srv1944548.hstgr.cloud` Ubuntu 24.04 **with Coolify**, `89.116.34.166` | Single VPS; Docker Manager API unsupported; **no second staging app proven** |
| Cloudflare DNS MCP | **needsAuth** — not authenticated | DNS for `auth-staging.postbus.in` **not verified** |
| Playwright in `package.json` | **absent** (`npx playwright` 1.64.0 exists on the machine, not a project dep) | n/a |
| Isolated test accounts | **none** | n/a |

**Conclusion:** There is **no** isolated hosted Auth environment. Names like “staging” in this repo mean **local CEPT/Postgres**, not a separate Supabase project.

---

## 2. Supabase project reference

**Not Available** for staging.

The only hosted project the tooling can see is **production** `hgacoeoovjxkzfbesmvl`.

Creating a new project, or `create_branch` on production, was **not** done (cost + isolation rules). `create_branch` would still be a child of production and is **forbidden** as “staging inside production.”

---

## 3. Staging hostname

**Not Available.** `auth-staging.postbus.in` was **not** created. DNS MCP unauthenticated. Even if created, `Domain=.postbus.in` cookies from production browsers would still be sent to that subdomain — tests must use a **synthetic isolated profile**, never a merchant profile.

Safer cookie-domain lab: a **separate registrable domain** (not `postbus.in`). That requires purchase/DNS — **approval required**.

---

## 4. Application commit SHA

Auth implementation: `ab8690e8a3f753b828910df91b70506b6106d00b`  
No staging application is running.

---

## 5. Browser version

**NOT EXECUTED** — no staging app URL.

---

## 6. Test account roles

**NOT CREATED.** No synthetic users were added to production Auth.

---

## 7–17. Browser / Auth tests

| # | Test | Result |
|---|---|---|
| 7 | Login | **BLOCKED** |
| 8 | Chrome persistent profile | **NOT EXECUTED** |
| 9 | Fresh browser context | **NOT EXECUTED** (would not equal real Incognito) |
| 10 | Multi-tab | **NOT EXECUTED** |
| 11 | Token expiration | **NOT EXECUTED** |
| 12 | Refresh-token behavior | **NOT EXECUTED** |
| 13 | Cookie migration | **NOT EXECUTED** |
| 14 | Network failure | **NOT EXECUTED** |
| 15 | Invalid session | **NOT EXECUTED** |
| 16 | Tenant isolation live | **NOT EXECUTED** (unit coverage from Phase 2.6 still PASS) |
| 17 | API authentication live | **NOT EXECUTED** (code coverage report still PASS) |

No invented results.

---

## 18. Performance observations

**NOT EXECUTED.** No `/token` counts from a staging GoTrue.

---

## 19. Test failures

Infrastructure gate failed closed **before** Playwright. No browser assertions ran.

Phase 2.7 added `lib/env/staging-isolation.ts`: if `POSTBUS_ENV=staging` **or** `NEXT_PUBLIC_APP_URL` is `auth-staging.postbus.in`, startup **throws** when Auth URL contains `hgacoeoovjxkzfbesmvl`. Unit tests: **3/3 PASS**.

---

## 20. Remaining risks

Same as Phase 2.6 plus: no live proof that Chrome persistent profiles keep sessions; no live Domain-cookie proof; production MCP still attached to the live project (operators must not run writes).

---

## Cost / approval gate (STOP)

| Resource | Provider | Expected cost | Purpose | Alternative |
|---|---|---|---|---|
| New Supabase project (Auth + DB) | Supabase | Free-tier **possible**; Pro/compute **possible billed** | Isolated GoTrue | Do not use production; do not `create_branch` on production |
| Staging Coolify application | Existing Hostinger Coolify VPS | Extra container RAM/CPU on the **same** production VPS | HTTPS app | Separate VPS safer; still needs approval |
| DNS `auth-staging.postbus.in` | Cloudflare (MCP unauthenticated) | Usually $0 if zone already owned | HTTPS host | Separate test domain (may cost) |
| Playwright in repo | npm | $0 | Browser QA | Add after staging URL exists |
| Local `supabase start` | Docker on laptop | $0 | Local GoTrue | **Cannot** prove `.postbus.in` cookies |

**Required permissions before continuing:** create **non-production** Supabase project; confirm billing; create **non-production** Coolify app + env; DNS hostname **or** dedicated test domain; synthetic users only on that project.

---

## Local alternative (evaluated, not started)

`supabase start` + `npm run staging:up` can exercise Auth **without** production. Limitations: HTTP localhost, no parent-domain cookie rules, JWT/reuse in `config.toml` are **local only** and must not be copied to production.

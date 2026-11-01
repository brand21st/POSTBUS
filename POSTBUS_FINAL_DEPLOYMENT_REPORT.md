# PostBus final deployment report

Date: 2026-10-30 (updated)  
**Final status: PRODUCTION DEPLOYMENT BLOCKED**

This prompt was **not** treated as production execution approval.  
Phases 9–13 were **not** executed.

Production identity (unchanged, read-only from earlier this day):

- Supabase: `hgacoeoovjxkzfbesmvl`
- Coolify app UUID: `mw9larpomkyonxzy1rk3h6jm` (not deployed)

Port **3000 PID 49940** was not modified. No production SQL writes, no Coolify deploy, no Git commit, no Git push.

---

## 1. Executive Summary

The remaining staging blocker was isolated Auth/PostgREST. Docker Engine was installed **inside WSL Ubuntu** (not Docker Desktop). Local `supabase start` then brought up Kong/GoTrue/PostgREST against a **new Docker Postgres** on host port **54332** (API **54321**), because `postbus_staging:55432` cannot host GoTrue/RLS/JWT.

That stack applied `20261030143000_shopify_address_normalization` to **empty** local data (0 orgs, 0 addresses). Staging Next on `:3001` briefly reported `database: Healthy` and `productionSupabaseDetected: false`. Two synthetic users were created on local GoTrue.

The WSL stack then **crash-looped** (Postgres recovery + Kong DNS 503). Password-grant login and RLS probes failed with HTTP 503. Containers were **stopped** to halt the loop. Full staging E2E, backup proof, and git isolation remain incomplete. Production is still **NO-GO**.

## 2. Final Staging Verification

| Item | Result |
| --- | --- |
| Staging Next `127.0.0.1:3001` | Running after env reload |
| Health (stable) | Flapped: Healthy while local Kong was up; **Error** after crash-loop/stop |
| CEPT stub `127.0.0.1:4099` | Still STUB |
| Approved Postgres `55432` `postbus_staging` | Still up; **not** used by Next (incompatible) |
| Alternative Docker Postgres | Schema migrated; empty merchant data; **stopped** after instability |
| Browser E2E | **Not executed** |
| Authenticated password login | **FAIL** (503) |

## 3. Auth / PostgREST Results

**Required:** GoTrue, PostgREST, JWT, RLS, RPC. Storage/Realtime used by some features; Storage was started then stopped.

**55432 incompatibility:** no `auth` schema, no JWT, no PostgREST, no production RLS. Not silently reused as the app database.

**Alternative stack this session:**

- Installed `docker.io` in WSL Ubuntu (root).
- Installed Linux Supabase CLI 2.115.0 as `/usr/local/bin/supabase-linux`.
- Moved local DB port in `supabase/config.toml` from **54322** (occupied by unidentified Windows `postgres.exe` PID 8444) to **54332**.
- Renamed duplicate local migration versions so `supabase start` could run:
  - `20261007140000_whatsapp_order_payment.sql` → `20261007140001_…`
  - `20261029120000_shopify_fulfillment_eligibility.sql` → `20261029120001_…`
  - These renames are **local CLI version keys only**. Production already has those features under different timestamps. **Do not `db push` this rename set to production.**
- `supabase start` (excluded studio/imgproxy/logflare/vector/edge-runtime) **succeeded once**.
- Project URL `http://127.0.0.1:54321`. JWT `ref` was not `hgacoeoovjxkzfbesmvl`.
- `GET /auth/v1/health` 200; PostgREST 200; app `/api/health` `database: Healthy`.
- Signup of `staging-org-a@postbus.invalid` and `staging-org-b@postbus.invalid`: 200, users created, no session (email confirm).
- Password grant: **503**. Kong logs: DNS failure for `supabase_auth_post_bus_app` while containers restarted. Postgres logs: unclean shutdown / recovery loop.
- `supabase stop --no-backup` executed. Local only.

## 4. Shopify E2E Results

**Not executed** (no stable Auth; Shopify keys empty on staging).

## 5. India Post E2E Results

CEPT stub only. App booking **not** executed.

## 6. Database Migration Status

### Docker local (while up)

- `current_database()` = `postgres` inside container `supabase_db_POST_BUS_APP`
- `address_manual_override` column present
- `supabase_migrations.schema_migrations` contains `20261030143000`
- `organizations` 0, `addresses` 0 (no merchant data)

### Approved 55432

Unchanged synthetic fixtures (3/2/3/1). Next does not connect here.

### Production (read-only, earlier)

`20261030143000` **not applied**. 173 orgs, 15,207 orders, 33,497 addresses, 2,926 shipments. Provenance columns absent. **No writes this session.**

## 7. Backup Verification

**Not verified.** No production backup or restore drill.

## 8. Release Commit / Artifact

HEAD still `8a52c36` on `fix/auth-session-stability`. Working tree remains a large mixed dirty set plus this session’s local-stack files. **No isolatable release commit.**

Do not deploy this tree. Do not `git add .`.

## 9. Coolify Deployment Status

**Not deployed.**

## 10. Worker Deployment Status

**Not deployed.**

## 11. Production Smoke Tests

**Not executed.**

## 12. Data Integrity Verification

Production untouched. Local Docker DB empty then stopped. 55432 synthetic booked fixture not rewritten this session.

## 13. Remaining Issues (P0)

1. Local Auth stack is **not stable** on this WSL2 Docker setup (crash loop).
2. Password login / RLS / browser E2E still not proven.
3. Git changeset not isolated.
4. Production backup/restore not proven.
5. Historical production addresses (~33k) will stay NULL validation until explicit revalidate after a future approved migration.

## 14. Final Production Status

**PRODUCTION DEPLOYMENT BLOCKED**

Not awaiting approval: mandatory gates still fail.  
Not completed: no production migration or Coolify deploy.

## 15. Exact Actions Executed

- Installed Docker Engine in WSL; started local Supabase; stopped it after crash-loop.
- Changed local `config.toml` DB port to 54332.
- Renamed two duplicate **local** migration filenames.
- Merged local anon/service keys into gitignored `.env.staging.local`.
- Restarted staging Next on 3001 only.
- Created two synthetic local Auth users.
- Read-only production inspection was **not repeated** this pass (already done earlier today).

## 16. Exact Actions Not Executed

- Production `apply_migration` / `db push` / `db reset`
- Coolify deploy
- Production backup/restore
- Git commit / push
- Full Shopify / booking / label / browser E2E
- Stable authenticated RLS matrix

## 17. Approval Records

None. This prompt is not execution approval.

## 18. Rollback / Recovery Information

Application: previous Coolify SHA. Database: additive migration not applied in production. Local Docker: stopped. Restore drill: unverified.

## 19. Git Status

Branch `fix/auth-session-stability`. Dirty tree including `supabase/config.toml` port change and renamed local migration files. No commit.

## 20. Production Monitoring Results

No production release.

---

## Pre-deployment gates

| Gate | Result |
| --- | --- |
| Full staging E2E | FAIL |
| Auth/PostgREST | **PARTIAL** — came up, then crash-looped and was stopped |
| RLS | FAIL |
| Shopify / India Post / barcode / labels E2E | FAIL |
| Historical impact assessed | PASS (read-only earlier) |
| Migration on PostgreSQL | PASS on empty Docker DB; PASS synthetic 55432; **not** on production |
| TypeScript / ESLint / build:verify | Not re-run this session |
| Release changeset isolated | FAIL |
| Backup/recovery | FAIL |
| No P0/P1 | FAIL |

**PRODUCTION DEPLOYMENT BLOCKED**

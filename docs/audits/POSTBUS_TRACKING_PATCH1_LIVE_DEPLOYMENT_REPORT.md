# POSTBUS TRACKING PATCH 1 — LIVE DEPLOYMENT REPORT

Date: 17 Oct 2026  
Scope: Patch 1 only (India Post login-auth tracking hold).  
Patches 2–4: **not started**.  
Database: **no migration, no schema change, no `supabase db push`**.  
Credentials / cron / env: **not modified**.

---

## 1. Executive Summary

A Patch 1-only commit was built on the verified production baseline, pinned in Coolify, and **manually deployed**. Coolify reported the deployment **finished** on SHA `d2beb8b420c70a9a68c22b60026b4128803e4a68` with application status `running:healthy`.

Immediate `GET https://www.postbus.in/api/health` returned a healthy JSON payload. Read-only SQL then showed the previously identified HTTP_400 login-storm organization **stopped creating `tracking-sync` jobs** after deploy, while other organizations continued tracking.

Approximately **16 minutes after** a healthy health check, the public origin began returning **Cloudflare 522**, Coolify `:8000` stopped accepting connections from this operator network, and `tracking-sync` inserts ceased (`max(created_at)` **2026-10-17 17:41:11 UTC**). Hostinger still reports the VPS **running**. The verified Coolify rollback (`git_commit_sha` pin to `f7c77ef…` + manual deploy) **could not be executed** because the Coolify API was unreachable.

**This is not a claim that Patch 1 caused the 522.** The outage coincided with the host becoming unreachable on public TCP, including Coolify itself.

---

## 2. Production Environment Identity

| Item | Value | Evidence |
| --- | --- | --- |
| Website | https://www.postbus.in | Public DNS / Cloudflare |
| Coolify application UUID | `mw9larpomkyonxzy1rk3h6jm` | Coolify GET (pre-outage) |
| Coolify FQDN set | includes `https://www.postbus.in`, `https://postbus.in`, sslip.io, tenant hosts | Coolify GET |
| Git repository | `brand21st/POSTBUS` | Coolify GET |
| Configured branch | `release/auth-session-on-prod` | Coolify GET |
| Auto-deploy | **false** (unchanged) | Coolify GET `is_auto_deploy_enabled` |
| Build pack | nixpacks | Coolify GET |
| Supabase | `hgacoeoovjxkzfbesmvl` (`https://hgacoeoovjxkzfbesmvl.supabase.co`) | MCP `get_project_url` |
| Hostinger VPS | id `1944548`, `srv1944548.hstgr.cloud`, `89.116.34.166` | Hostinger `vps_virtual-machines_list` |
| VPS hypervisor state | `running` (no Hostinger stop/restart action in this window) | Hostinger GET |

---

## 3. Previous Production SHA

`f7c77efde2818198bc4f55fa1a82574d7952057b`  
Revalidated before pin/deploy. Parent of the release commit.

---

## 4. New Release SHA

`d2beb8b420c70a9a68c22b60026b4128803e4a68`  
Message: `fix(tracking): prevent auth failure job storm`

---

## 5. Release Branch

- Isolated worktree branch: `release/postbus-tracking-patch1-live`
- Coolify configured branch: `release/auth-session-on-prod` (fast-forwarded to the same Patch 1 commit; auto-deploy remained off)
- Deploy method: Coolify `PATCH git_commit_sha=d2beb8b…` then `POST /api/v1/deploy?uuid=mw9larpomkyonxzy1rk3h6jm&force=true`

---

## 6. Git Diff Verification

```
git diff --stat f7c77efde2818198bc4f55fa1a82574d7952057b d2beb8b420c70a9a68c22b60026b4128803e4a68
```

10 files, **1066 insertions / 40 deletions**. Dirty development tree was **not** deployed.

---

## 7. Files Changed

| Path | Role |
| --- | --- |
| `modules/india-post/login-auth.ts` | Login-origin classification |
| `modules/india-post/login-auth.test.ts` | Tests |
| `modules/india-post/tracking-auth-hold.ts` | Org-scoped hold / cooldown / probe throttle |
| `modules/india-post/tracking-auth-hold.test.ts` | Tests |
| `modules/india-post/tracking-auth-hold.pg.test.ts` | PGlite tests |
| `modules/india-post/tracking-sync.ts` | Enqueue skip + duplicate QUEUED/PENDING cancel |
| `modules/india-post/tracking-sync.test.ts` | Tests |
| `modules/india-post/provider.ts` | `createIndiaPostLoginError` on `login()` |
| `modules/india-post/provider.session.test.ts` | Booking code still `HTTP_400` |
| `workers/processor.ts` | Tag confirmed tracking login auth as `PERMANENT_AUTH_ERROR` |

No migrations, no Shopify fulfillment module changes, no Razorpay/WhatsApp/barcode/label/booking payload changes.

---

## 8. Automated Test Results

Executed in isolated worktree (not the dirty `fix/auth-session-stability` tree), recorded in `POSTBUS_TRACKING_PATCH1_RELEASE_CANDIDATE.md`:

- Vitest (9 files): **79 tests, exit 0**
- `npx tsc --noEmit`: **exit 0**
- ESLint on Patch 1 files: **exit 0**

Synthetic mocks / PGlite only. Production `.env.local` was not loaded for those tests. No live CEPT / Shopify writes.

---

## 9. Production Build Result

`npx next build` in the isolated worktree: **exit 0** (Next.js 16.3.8). Placeholder public env only. No production secrets in the build command.

Coolify nixpacks then built the same SHA on the VPS.

---

## 10. Database Migration Status

**NONE required. NONE performed.**

---

## 11. Deployment Authorization Scope

User master prompt: **production-only Patch 1**. No staging. No Patch 2/3/4. No unrelated dirty-tree features.

---

## 12. Coolify Deployment ID

`ildelhlvsqtai5426hymf7yc`

---

## 13. Deployment Start and End Time

| Event | UTC |
| --- | --- |
| Deployment polled `in_progress` on SHA `d2beb8b…` | from ~2026-10-17 17:16 |
| Coolify `finished_at` | **2026-10-17 17:25:23Z** |
| Coolify app after finish | `running:healthy`, `git_commit_sha=d2beb8b420c70a9a68c22b60026b4128803e4a68` |
| First post-deploy public health JSON | ~2026-10-17 17:28Z (`success:true`) |
| Last `tracking-sync` `created_at` observed | **2026-10-17 17:41:11Z** |
| Operator `GET /api/health` Cloudflare **522** | from ~2026-10-17 17:45Z (still 522 at 17:50Z) |
| Coolify API `89.116.34.166:8000` | connect timeout from operator network after ~17:43Z |

---

## 14. Live Website Health

| Time (UTC) | Result |
| --- | --- |
| ~17:28 | `GET /api/health` → `{"success":true,"data":{"api":"Healthy","database":"Healthy","redis":"Disabled","jobRunner":"database","jobs":"Warning","shopify":"Warning","indiaPost":"Warning"}}` |
| 17:45–17:50 | Cloudflare **522**; origin `http://mw9larpomkyonxzy1rk3h6jm.89.116.34.166.sslip.io` connect timeout |

`jobs`/`shopify`/`indiaPost` **Warning** was already the pre-deploy health shape, not a new Patch 1 signal.

**Current public health: UNHEALTHY (522).** SHA cannot be re-read from Coolify until `:8000` answers.

---

## 15. Job Runner Health

Until 17:41 UTC, `tracking-sync` rows continued to be inserted (workers alive). After 17:41, no further creates observed in the query window. Cron/worker liveness after 17:41: **UNVERIFIED** (origin down). Pre-deploy `JOB_RUNNER=database` was not changed.

---

## 16. Authentication Hold Verification

Hashed organization `md5(organization_id)=7fdb45679868ff9b82b0590eb23d1052` (the only org with HTTP_400 `tracking-sync` in the prior 24h: **1395** rows; last job **2026-10-17 17:24:09Z**, one minute before deploy finish):

| Window | Created | HTTP_400 |
| --- | --- | --- |
| ~1 hour before deploy | 54 | 53 |
| Since `finished_at` through 17:43Z (~18 min) | **0** | **0** |

No `PERMANENT_AUTH_ERROR` rows yet (expected until a recovery probe actually fails login under the new tagger).

**CONFIRMED:** that org no longer enqueued every minute after the new code was live.  
**UNVERIFIED:** Coolify log lines `india_post.tracking.auth_hold` (log API later unreachable; do not invent counts).

Strike history of 10 consecutive confirmed HTTP_400 failures implies **24-hour** cooldown (not 15 minutes). Zero jobs for 18 minutes is consistent with hold, not with an immediate probe.

---

## 17. Cooldown Verification

Code path 15m → 1h → 4h → 12h → 24h max: **tested locally**.  
Live: long-running storm org matches **max cooldown** behavior. Intermediate steps **not observed** on a fresh first-failure org in this window.

---

## 18. Recovery-Probe Verification

**UNVERIFIED in production** in this window (held org correctly silent; 24h delay expected). Do not treat “no probe yet” as a probe-throttle bug.

---

## 19. Healthy Organization Tracking

Since deploy through 17:43Z, multiple other org hashes continued `tracking-sync` at ~1 job/minute (examples: 16 created / 15–16 SUCCEEDED). HTTP_403 FAILED volume continued for some orgs (**Patch 1 does not hold bulk HTTP_403**).

---

## 20. India Post Booking Health

| Metric | Value |
| --- | --- |
| Pre-deploy ~60m (`shipment-booking`) | 7 created / 3 FAILED / 4 SUCCEEDED (earlier session) |
| Last booking `created_at` | **2026-10-17 17:06:32Z** (before deploy finish) |
| Created after deploy finish | **0** in the 17:25–17:43 query |

**No post-deploy booking sample.** Cannot claim improvement or regression from job counts. Last booking predates deploy. No manual live booking tests were run.

---

## 21. Shopify Fulfillment Health

| Metric | Value |
| --- | --- |
| Pre-deploy ~60m | 27 created / 0 FAILED (earlier session) |
| Last fulfillment `created_at` | **2026-10-17 17:07:12Z** (before deploy finish) |
| Created after deploy finish | **0** in the 17:25–17:43 query |
| Rolling 60m at 17:43 | 22 created / 0 FAILED (all pre-deploy in that hour) |

**No post-deploy Shopify sample.** Patch 1 did not change fulfillment modules. No manual fulfillment tests were run.

---

## 22. Multi-Tenant Safety

SQL showed the HTTP_400 org at **0** creates while other hashed orgs continued SUCCEEDED/FAILED independently. No evidence of a global tracking stop **before** the later origin outage. Cross-tenant data access: **not re-tested live** (no production probes).

---

## 23. Error Logs Summary

Coolify application logs were readable earlier in the session; a later logs GET **failed** (`Unable to connect to the remote server`). **No credential or provider body dumps** are included here.

Post-deploy `tracking-sync` `last_error_code` through 17:43Z: **HTTP_403 only** (130 FAILED). HTTP_400: **0**.

---

## 24. Production Monitoring Metrics

Comparison windows are labeled. **Do not treat 24h totals as a Patch 1 result** (they are dominated by pre-deploy history).

### Pre-deploy (this session, before pin)

`tracking-sync` 60m: **1150 created / 575 FAILED**  
`tracking-sync` 24h: **28708 created / 2667 FAILED** / ~1400 authish (`HTTP_400`/`HTTP_401`/`PERMANENT_AUTH_ERROR`)

Historical RCA (different 24h ending ~14:53Z): 28,702 / 1,424 FAILED / 1,405 confirmed login-auth.

### Immediately after deploy (~17:28Z, ~3 min)

Created since `finished_at`: 59; FAILED 22 (**all HTTP_403**); SUCCEEDED 31.

### ~18 min after finish (query `utc_now` 17:43:23Z)

| Metric | Value |
| --- | --- |
| `tracking-sync` created since deploy | 317 |
| FAILED | 130 |
| SUCCEEDED | 166 |
| CANCELLED | 0 |
| HTTP_400 | **0** |
| HTTP_403 | 130 |
| Rolling 15m created/FAILED/OK | 258 / 103 / 134 |
| Rolling 60m created/FAILED/OK | 1099 / 524 / 554 |
| Rolling 24h created/FAILED/HTTP_400/HTTP_403 | 28644 / 2870 / 1380 / 1464 |

HTTP_403 FAILED rate is **outside Patch 1 scope**.

### After origin 522

Last `tracking-sync`: **17:41:11Z**. Public health **522**. Coolify API **unreachable**. Hostinger metrics last sample **17:17:26Z** (CPU ~31%, RAM ~2.0→2.47 GiB across 16:15–17:17; **no metric point after the outage**).

`tracking_events.created_at` last row **2026-09-26** (table appears stale vs live apply-tracking; **not used** as a deletion signal). No DELETE of tracking/jobs was performed.

---

## 25. Rollback Preparedness

| Item | Status |
| --- | --- |
| Prior healthy SHA | `f7c77efde2818198bc4f55fa1a82574d7952057b` |
| Procedure | `PATCH git_commit_sha` to that SHA, keep auto-deploy **false**, `POST /api/v1/deploy?uuid=…&force=true`, wait `finished`, confirm health + SHA |
| Database restore | **Not required** (no migration) |
| Branch note | `release/auth-session-on-prod` currently points at Patch 1; rollback **must re-pin SHA** (do not leave an unsafe HEAD if auto-deploy is later enabled) |

---

## 26. Rollback Execution, If Any

**NOT EXECUTED.** Coolify API connect timeout on `89.116.34.166:8000`. No Hostinger VPS restart, no backup restore, no firewall change, no database restore.

---

## 27. Known Remaining Risks

1. **Public origin 522 / VPS TCP unresponsive** — production website and Coolify UI/API were down from this operator network at report time. Hypervisor still `running`.
2. HTTP_403 tracking failures continue for some orgs (not Patch 1).
3. Duplicate QUEUED race remains (cancel is best-effort; 0 CANCELLED observed in 18 min).
4. Hold depends on retained FAILED job rows.
5. 24h hold on the storm org delays credential recovery until cooldown or a successful `last_verified_at` / `last_refreshed_at`.
6. Booking/Shopify post-deploy job samples were empty (quiet period, then outage).
7. 18-minute SQL window cannot prove 24-hour reliability.
8. Causal link from Patch 1 → 522 is **unproven**; Coolify itself was also unreachable.

---

## 28. Production Release Verdict

**E. INSUFFICIENT EVIDENCE** for *current* live SHA and application health (origin 522, Coolify unreachable).

**Deployment itself was confirmed finished** (`ildelhlvsqtai5426hymf7yc`, SHA `d2beb8b…`, `finished_at` 17:25:23Z). Immediate health JSON succeeded. Auth-storm enqueue suppression was observed in SQL before the outage.

Not **A** (health not currently verified).  
Not **B** (origin is not healthy).  
Not **C** (deploy was performed).  
Not **D** (rollback was not performed).

---

## 29. Follow-Up Monitoring Plan

When the VPS/Coolify accepts TCP again (do **not** improvise a host rebuild):

1. Coolify GET application: status, `git_commit_sha`, auto-deploy still false.
2. `GET https://www.postbus.in/api/health`.
3. If SHA ≠ `d2beb8b…` or health stays down after a short stabilize window: execute **rollback-pin** to `f7c77ef…`.
4. If SHA matches and health returns: re-query storm-org hash creates vs HTTP_403 orgs; 60m/24h `tracking-sync`; booking and Shopify FAILED rates.
5. Coolify logs: count `india_post.tracking.auth_hold` reasons only (no error bodies).
6. Do **not** start Patch 2/3/4 until origin is stable.

No unattended 24h monitor was scheduled in this session.

---

## 30. Recommended Next Step

Coolify and the public site recovered. A verified **force redeploy of the same Patch 1 SHA** completed (see §31). Continue 24-hour job-rate monitoring. Do not start Patch 2/3/4. Rollback remains pin-and-deploy `f7c77efde2818198bc4f55fa1a82574d7952057b` with auto-deploy off.

---

## 31. Verified Coolify redeploy (17 Oct 2026 ~18:25–18:38 UTC)

Pre-deploy checks (this pass):

| Check | Result |
| --- | --- |
| `GET https://www.postbus.in/api/health` | HTTP **200**, `api`/`database` Healthy |
| Coolify app | `running:healthy`, UUID `mw9larpomkyonxzy1rk3h6jm` |
| Pinned SHA | already `d2beb8b420c70a9a68c22b60026b4128803e4a68` |
| Git `origin/release/auth-session-on-prod` | same SHA |
| Auto-deploy | **false** |
| Hostinger VPS `1944548` | `running` |

Action: `PATCH git_commit_sha=d2beb8b…` then `POST /api/v1/deploy?uuid=mw9larpomkyonxzy1rk3h6jm&force=true`. Dirty development tree **not** used.

| Item | Value |
| --- | --- |
| Deployment UUID | `8feu47e5xxproh4fn32indif` |
| Commit | `d2beb8b420c70a9a68c22b60026b4128803e4a68` |
| Branch imported | `release/auth-session-on-prod` |
| `finished_at` | **2026-10-17 18:38:45Z** |
| After finish | Coolify `running:healthy`, SHA unchanged |
| Auto-deploy | still **false** |
| Health after finish | HTTP **200** same JSON shape |
| Homepage | HTTP **200** |

Database: **no migration**. Env/cron: **unchanged**.

---

## Pre-deploy gates (historical)

Gates 1–20 were treated as **PASS** before the Coolify deploy command (identity, baseline SHA `f7c77ef`, Patch 1-only diff, tests/tsc/lint/build, no migration, rollback procedure documented, auto-deploy off). Post-deploy gate “health remains healthy” later **failed** at the public edge (522).

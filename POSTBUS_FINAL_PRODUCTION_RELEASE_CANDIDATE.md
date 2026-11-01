# PostBus final production release candidate gate

Date: 2026-10-31  
HEAD: `8a52c36` on `fix/auth-session-stability`  
Dirty porcelain: **869** paths  

## Mandatory gates

| Gate | Status |
| --- | --- |
| Stable staging Supabase | CONDITIONAL (Auth RestartCount 3 after start; later 60s stable) |
| Stable PostgreSQL | PASS this window (RestartCount 0) |
| Working GoTrue | PASS API; FAIL Cursor-browser fetch |
| Working PostgREST | PASS after **local-only** GRANTs |
| JWT verified | PASS API |
| RLS verified | PASS API |
| Tenant isolation | PASS API |
| Shopify E2E | FAIL (unit only) |
| Historical booking E2E | PARTIAL (classify API PASS; full booking worker NOT COMPLETE) |
| India Post mock E2E | FAIL (stub up; no authenticated book-through) |
| Barcode safety | PARTIAL (unit + no classify-path allocation) |
| Label generation | FAIL (unit only; no browser PDF) |
| Browser E2E | FAIL |
| Migration history reconciled | PASS as a **plan**; production not applied |
| Production schema verified in staging | PASS on `postbuslocal` only |
| Historical merchant data protected | PASS (no prod writes; no bulk READY) |
| Release changeset isolated | FAIL (869 dirty; worktree uncommitted) |
| TypeScript | PASS (`npm run typecheck` exit 0) |
| ESLint | PARTIAL (changed files 0; full `npx eslint .` not rerun) |
| Production build | PASS (`npm run build:verify` exit 0, ~168s) |
| Regression tests | PARTIAL (184 vitest this pass: 50 + 134) |
| Backup availability | FAIL / AWAITING APPROVAL |
| Recovery procedure verified | FAIL / AWAITING APPROVAL |
| Rollback plan | DOCUMENTED, not drilled |
| No unresolved P0/P1 | FAIL |

## Verdict

**PRODUCTION DEPLOYMENT: NO-GO**  
**POSTBUS PRODUCTION RELEASE CANDIDATE: NOT READY**

## Safety

- No production migration  
- No production SQL writes (read-only grants/columns/migrations/advisors/branches only)  
- No Coolify deploy  
- No Shopify mutation  
- No real India Post booking  
- No production barcode allocation  
- No production order reprocessing  
- No git commit / push  
- Port 3000 left alone (observed LISTENING pid 54996; not started/stopped by this agent)

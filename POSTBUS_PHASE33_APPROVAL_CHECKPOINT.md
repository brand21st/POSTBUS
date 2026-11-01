# POSTBUS PHASE 3.3 — PRODUCTION EXECUTION CHECKPOINT

**Status: PRODUCTION_NOT_APPROVED**

This checkpoint is the Phase A deliverable. Phase B must not start in the same instruction without a new explicit approval that quotes the items below.

1. **Production project reference:** `hgacoeoovjxkzfbesmvl` (MCP URL verified).  
2. **Exact migration filenames:** the eight files in `POSTBUS_PHASE33_MIGRATION_INVENTORY.md`.  
3. **Checksums:** SHA-256 listed in that inventory and in `modules/affiliates/production-gate.ts`.  
4. **Schema compatibility:** additive; `create_organization_for_user` and `payments` columns present; affiliate tables absent.  
5. **Existing billing impact:** none while flags stay false. 122000 ALTERs webhook events (4 processed rows).  
6. **Webhook lease impact:** HIGH. Enable affiliates only after 122000.  
7. **Locks:** short ACCESS EXCLUSIVE on webhook ALTER; index create on 4 rows.  
8. **Estimated execution risk:** HIGH overall (financial schema on live project). Duration: minutes.  
9. **Backup/recovery:** **NOT VERIFIED** — blocker.  
10. **Privileges:** service-role / migration owner to apply SQL; not granted by this prompt.  
11. **Application deploy:** compatible if `POSTBUS_AFFILIATES_ENABLED` remains false.  
12. **Feature flags:** leave all affiliate/tax/payout flags false on Coolify.  
13. **Financial features remaining disabled:** accrual, payouts, tax automation, tax invoice issuance.  
14. **Monitoring:** webhook 5xx, partner AUTH_UNAVAILABLE, org RPC errors.  
15. **Outstanding blockers:** backup/PITR proof; operator name; deployment window token; explicit write authorization; `next start` hydration; hosted RLS after apply.  
16. **Exact proposed production writes (for a later approval):** apply only the eight checksummed SQL files. No DML on orders/shipments/payments. No test users.  
17. **Exact proposed application deployment:** none this phase. Later: ship code with flags off, then a separate flag change.  
18. **Rollback:** PITR/snapshot; see `POSTBUS_PHASE33_ROLLBACK_PLAN.md`.  
19. **Explicit approval status:** **NOT RECEIVED.** Gate run: `{"ok":false,"reason":"project_ref_mismatch"}` then `PRODUCTION_NOT_APPROVED`. Authorization env vars were **not** set.  
20. **Recommended execution order:** backup confirm → gate env by operator → SQL 1–8 → schema verify → flags still off → optional app deploy → later UI flag → later accrual.

## Tokens the operator must supply later (do not invent in chat secrets)

- `AFFILIATE_PRODUCTION_PROJECT_REF=hgacoeoovjxkzfbesmvl`  
- `AFFILIATE_PRODUCTION_WRITE_AUTHORIZATION=AFFILIATE_PRODUCTION_MIGRATE_APPROVED_hgacoeoovjxkzfbesmvl`  
- `AFFILIATE_PRODUCTION_MIGRATION_SCOPE=` (eight filenames)  
- `AFFILIATE_PRODUCTION_CHECKSUMS=` (eight hashes)  
- `AFFILIATE_PRODUCTION_BACKUP_CONFIRMED=OPERATOR_CONFIRMED_PITR_OR_BACKUP`  
- `AFFILIATE_PRODUCTION_OPERATOR=` (named person)  
- `AFFILIATE_PRODUCTION_WINDOW=AFFILIATE_PRODUCTION_WINDOW_OPEN`  

Generic `APPROVED=true` is rejected. Staging token is rejected.

**STOP. Waiting for explicit user approval of Phase B.**

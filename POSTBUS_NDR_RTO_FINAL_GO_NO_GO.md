# POSTBUS NDR/RTO — Final Go / No-Go

Release: `release/ndr-rto-isolated` @ `865d295d8401aa55a3b20c6a1f937ceda94d846a`  
Production live: `support-center-release` @ `67891d40ea8f7ad6c4f07890085c8dcefbfd4833`

**GO FOR RELEASE APPROVAL does not authorize git push or Coolify deploy.**

## Scorecard

| Area | Rating | Notes |
|---|---|---|
| SOURCE ISOLATION | **GREEN** | 18 files; bulk/support/billing/processor excluded |
| P0 DELIVERED/NDR FIX | **GREEN** | `item_delivered` before NDR; no bare addressee |
| NDR CLASSIFICATION | **GREEN** | Explicit reason / phrases only |
| RTO CLASSIFICATION | **GREEN** | `rts === true` → RTO not RTO_DELIVERED; return delivery remapped |
| TRACKING PIPELINE | **GREEN** | Mapper → plan → persist → dashboard |
| OPERATIONAL PERSISTENCE | **GREEN** | PGlite tests write `operational_status` |
| DATABASE COMPATIBILITY | **GREEN** | Columns + RLS already in production; no migration |
| SHOPIFY ISOLATION | **GREEN** | Mocks; OFD/NDR does not fulfill |
| WHATSAPP ISOLATION | **GREEN** | Existing three events only |
| TENANT SECURITY | **GREEN** | org filters; RLS unchanged |
| WORKER COMPATIBILITY | **GREEN** | Processor unchanged; YELLOW residual during rolling mapper swap |
| TYPESCRIPT | **GREEN** | PASS |
| PRODUCTION BUILD | **GREEN** | PASS locally after env/junction workaround; Linux unverified |
| COOLIFY CONFIGURATION | **GREEN** | Auto-deploy off; no new secrets |
| ROLLBACK READINESS | **GREEN** | Redeploy `67891d40`; new `operational_status` values are extra columns old code already has |

Live CEPT return-completion **event names**: **UNVERIFIED** (fixtures only). Does not block classification design.

## Decision

**CONDITIONAL GO**

Conditions remaining before an operator should approve **push + manual deploy**:

1. Accept Linux/nixpacks Node 22 as residual (not proven in this worktree).
2. Keep auto-deploy **off**. Deploy only by Coolify manual action after the SHA is visible on the watched branch.
3. Do not merge `india-post-true-bulk-candidate`.
4. Do not run production reconciliation apply.
5. Expect a short window where old and new mappers can coexist.

## Next approval required

Explicit written approval to:

1. `git push -u origin release/ndr-rto-isolated`
2. Integrate **only** `865d295d8401aa55a3b20c6a1f937ceda94d846a` onto `support-center-release`
3. Manually deploy Coolify application `mw9larpomkyonxzy1rk3h6jm`

Until that approval: **STOP**.

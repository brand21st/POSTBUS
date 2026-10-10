# POSTBUS Tracking P0 — Go / No-Go

| Gate | Rating |
|---|---|
| Production baseline | GREEN (`865d295` live) |
| Canary isolation | GREEN (off unless org+allowlist) |
| Binary split | GREEN (canary job budget 32; legacy unused) |
| Auth cooldown | GREEN (DB FAILED + 30 min; survives restart) |
| Mapper NDR/RTO | GREEN (unchanged) |
| Database / migrations | GREEN |
| Shopify/WhatsApp canary | GREEN (`skipSideEffects` default) |
| Coolify auto-deploy | GREEN (off) |
| Tests / tsc / build | GREEN |
| Deployment | **NOT AUTHORIZED** |
| Live canary | **NOT AUTHORIZED** |
| Fleet rollout | **NOT AUTHORIZED** |

## Decision

**GO FOR DEPLOYMENT APPROVAL** of the local release commit, **with canary env left empty**.

Does **not** authorize push, Coolify deploy, live CEPT, or historical reconciliation.

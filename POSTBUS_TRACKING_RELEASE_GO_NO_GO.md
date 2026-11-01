# POSTBUS Tracking Ingestion — Go / No-Go

Local branch: `fix/tracking-ingestion-p0`  
Base: `865d295d8401aa55a3b20c6a1f937ceda94d846a`

**This does not authorize git push or Coolify deploy.**

| Area | Rating |
|---|---|
| Root-cause fix (`last_tracked_at` vs HTTP 200) | GREEN |
| Bounded 400 isolation | GREEN (cause of live 400 still UNVERIFIED without CEPT) |
| Auth cooldown / no infinite requeue | GREEN |
| Documented token refresh URL | N/A — CEPT only documents `/access/login`; re-login + one 401 retry |
| NDR/RTO classifier | GREEN (unchanged) |
| Booking / Shopify / WhatsApp | GREEN (unchanged gates) |
| Schema / production data | GREEN (no migration, no writes) |
| Tests | GREEN (86 passed) |
| TypeScript | GREEN |
| Production build | GREEN (Windows; Linux unverified) |
| Canary | NOT RUN |

## Decision

**CONDITIONAL GO FOR RELEASE APPROVAL**

Conditions:

1. Push/deploy only after explicit approval.
2. First production action after deploy is the **single-org canary**, not fleet poll.
3. Do not enable webhooks or run reconciliation.
4. Accept that live HTTP 400 meaning is still inferred until canary evidence.

## Next approval required

1. Local review of `fix/tracking-ingestion-p0`
2. `git push` of that branch only (not `india-post-true-bulk-candidate`)
3. Integrate onto `support-center-release` and **manual** Coolify deploy
4. Written org id for the canary

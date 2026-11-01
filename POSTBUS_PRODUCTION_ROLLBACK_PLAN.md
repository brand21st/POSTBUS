# PostBus production rollback plan

Date: 2026-10-31  
**Restore drill: NOT VERIFIED.** This is a plan, not proven recovery.

## Application

Coolify UUID `mw9larpomkyonxzy1rk3h6jm`. Rollback = redeploy the previous known-good git SHA / image. Do not `force` a dirty working tree.

Workers: redeploy the matching previous worker image so booking/Shopify jobs do not mix schema assumptions.

## Database

Migration `20261030143000` is additive. After apply, **do not DROP columns** to “roll back” — that can fail with views/code still reading them.

True data recovery: Supabase PITR / dashboard backup restore onto a **new** project or confirmed restore flow, then cut over only with owner approval.

This session did **not** create a backup or restore into an isolated project.

## Abort criteria (if a future approved deploy proceeds)

- Health `database: Error` after deploy
- Spike in booking VALIDATION_ERROR vs baseline
- Any barcode allocated for INVALID/NEEDS_REVIEW
- Address street changes on posted shipments
- Cross-tenant errors

Stop rollout. App rollback first. Do not automatic destructive SQL rollback.

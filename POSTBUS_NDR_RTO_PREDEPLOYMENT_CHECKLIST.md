# POSTBUS NDR/RTO PRE-DEPLOYMENT CHECKLIST

Do not tick production steps until the user explicitly authorizes deploy. **This checklist is not authorization.**

## Pre-deployment (local — done this session)

- [x] Independent mapper review: Delivered(Addressee) is DELIVERED; bare addressee removed
- [x] Hold/intimation not NDR; redirect not auto RTO
- [x] rts=true → RTO not RTO_DELIVERED; return delivery remapped
- [x] Duplicate NDR attempts not incremented; older events skipped
- [x] Missing bulk timestamps do not use `Date.now()` for status
- [x] Shopify OFD-after-NDR isolated
- [x] Reconcile dry-run only; apply throws; production host blocked
- [x] Vitest 105/105
- [x] tsc pass after scripts exclude
- [x] `npm run build` retry PASS
- [x] Local commit `40ed3fb` — not pushed
- [x] Unrelated dirty files left unstaged
- [x] Coolify live SHA verified `67891d40ea8f7ad6c4f07890085c8dcefbfd4833`
- [x] Health GET only

## Pre-deployment (requires user)

- [ ] Choose deploy vehicle: cherry-pick onto `support-center-release` **or** merge branch (branch includes bulk booking + support center)
- [ ] Confirm Coolify still targets PostBus `mw9larpomkyonxzy1rk3h6jm`
- [ ] Confirm production backup / snapshot policy
- [ ] Confirm workers and app deploy same SHA
- [ ] Confirm `INDIA_POST_WEBHOOK_ALLOWED_CIDRS` stays empty (quarantine)
- [ ] Confirm no reconcile apply job is configured
- [ ] Explicit **deploy** approval

## Deployment (DO NOT EXECUTE)

- [ ] Push or merge only the approved SHA
- [ ] Coolify deploy that SHA
- [ ] Do not run migrations
- [ ] Do not restart extra workers beyond Coolify rollout
- [ ] Do not POST tracking-sync as a test

## Post-deployment (after approval)

- [ ] GET `/api/health`
- [ ] Watch `india_post.tracking.sync_ok` / `sync_fail`
- [ ] Confirm a **new** Delivered(Addressee) scan writes `operational_status=DELIVERED`
- [ ] Confirm dashboard unclassified vs bucket honesty
- [ ] Confirm no Shopify storm / no new NDR WhatsApp
- [ ] Historical backfill still **off**

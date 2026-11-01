# POSTBUS NDR/RTO — Production Deploy Plan (DO NOT EXECUTE)

This is instructions only. No push and no Coolify change has been made.

## Identifiers

| Item | Value |
|---|---|
| Coolify app | `mw9larpomkyonxzy1rk3h6jm` |
| UI | `http://89.116.34.166:8000/project/1tko9msc25imaecnzsmntip2/environment/phidg7utdwrrrebgpq2mm9am/application/mw9larpomkyonxzy1rk3h6jm` |
| Production branch **currently watched** | `support-center-release` |
| Verified live SHA | `67891d40ea8f7ad6c4f07890085c8dcefbfd4833` |
| Isolated branch | `release/ndr-rto-isolated` |
| Isolated commit | `865d295d8401aa55a3b20c6a1f937ceda94d846a` |
| Rollback SHA | `67891d40ea8f7ad6c4f07890085c8dcefbfd4833` |
| Database | `hgacoeoovjxkzfbesmvl` (no migration in this release) |

## Push vs deploy

`settings.is_auto_deploy_enabled` is **false**. Preview deploys are **false**.

- Pushing `release/ndr-rto-isolated` does **not** retarget production (Coolify still watches `support-center-release`).
- Pushing `support-center-release` also should **not** auto-deploy while auto-deploy stays off; GitHub webhook secret exists, so treat any push to the watched branch as **high caution**.
- **Do not push until explicitly approved.** After approval, preferred sequence:

  1. `git push -u origin release/ndr-rto-isolated` (creates reviewable remote branch; should not deploy).
  2. Fast-forward or merge **only these 18 files / this commit** onto `support-center-release` (do not merge `india-post-true-bulk-candidate`).
  3. In Coolify, **manual deploy** of `mw9larpomkyonxzy1rk3h6jm` after confirming git SHA `865d295d8401aa55a3b20c6a1f937ceda94d846a` (or the merge commit if one is created — record that SHA before clicking Deploy).
  4. Do not enable CEPT webhook CIDRs.
  5. Do not run historical reconciliation apply.
  6. Do not change cron schedules.

## Build / worker behavior

- Install: `NPM_CONFIG_PRODUCTION=false npm install --no-audit --no-fund --include=optional --include=dev`
- Build: `npm run build`
- Start: `npm start`
- `JOB_RUNNER=database` — tracking-sync jobs drain via existing `POST /api/cron/jobs` (`tracking-sync`). Processor file is **unchanged**; job names/payloads remain compatible.
- Mixed-version window: old image still classifies `Item Delivered(Addressee)` as NDR until only the new image remains.

## Health checks

- Coolify health check is enabled.
- After deploy: `GET /api/health`, Coolify status `running:healthy`, smoke `/dashboard/ndr-rto` as a merchant (counts use stored `operational_status` only).
- Monitoring window: 30–60 minutes of tracking-sync / dashboard unclassified vs NDR (expect unclassified historical rows until a **later approved** dry-run).

## Config

No new mandatory secrets. Tracking-sync intervals already default in code. Empty `INDIA_POST_WEBHOOK_ALLOWED_CIDRS` stays quarantined.

## Forbidden during deploy

Production DB writes beyond normal live tracking; migrations; backfill; CEPT webhook activation; Shopify/WhatsApp tests against live stores; worker restarts outside the Coolify rollout; billing changes.

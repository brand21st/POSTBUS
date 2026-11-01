# PostBus production recovery runbook

Date: 2026-10-31  
Production project: `hgacoeoovjxkzfbesmvl`  
Coolify application UUID: `mw9larpomkyonxzy1rk3h6jm` (identifier only; **no deploy**)

## Backup method

Supabase-managed project backups / PITR (dashboard). MCP in this session exposes branches, migrations, advisors, SQL — **not** a backup catalog. `list_branches` returned **[]**. No preview branch.

## Recovery point

**Unknown.** No backup timestamp, WAL location, or snapshot ID was retrieved.

## Backup verification

**BACKUP/RESTORE VERIFICATION: AWAITING APPROVAL**

Not listed, not downloaded, not restored. Do not copy production customer data into an unapproved local database.

## Restore procedure (do not execute)

1. Owner approval naming the project, restore target (new project **or** in-place — in-place is destructive), and recovery timestamp.  
2. Dashboard: Project → Database → Backups → restore to **isolated** target when possible.  
3. Permissions: project Owner / `supabase` login that can restore.  
4. Estimate: typically tens of minutes for a multi-GB project; confirm size in dashboard first.  
5. After restore: compare `supabase_migrations.schema_migrations`, order/shipment counts, and a sample booked barcode.  
6. Point the **staging** app at the restored isolated project only after URL/key rotation. Never attach production Coolify to a half-restored DB.

## Application rollback

Redeploy the last known-good Coolify image/SHA for `mw9larpomkyonxzy1rk3h6jm`. Do not deploy this dirty tree.

## Worker rollback

Redeploy the matching previous worker image so booking/Shopify jobs share schema assumptions with the app.

## Schema rollback

`20261030143000` is additive. **Do not DROP** those columns to undo a release. App rollback first.

## Failure escalation

Owner → Supabase support (restore) + Coolify rollback. Abort if booked snapshots change or cross-tenant access appears.

## Data integrity checks (post-restore, approved target only)

- Count orders, addresses, shipments vs pre-change notes  
- Posted/in-transit barcodes unchanged  
- `address_validation_status` still NULL on legacy rows until on-demand classify  
- No extra migrations beyond the approved set

# PostBus production backup and recovery

Date: 2026-10-31  
Project: `hgacoeoovjxkzfbesmvl`  
Coolify UUID (identity only): `mw9larpomkyonxzy1rk3h6jm`

## Availability

Supabase-managed backups / PITR are the expected method. This session’s API can list migrations, advisors, and branches. `list_branches` was `[]`. **No backup catalog, retention, or recovery-point timestamp was returned.**

## Restore test

**NOT PERFORMED.** Creating or exporting a production backup, and restoring it, was not authorized. No customer data was copied locally.

## Rollback (plan only)

- App: redeploy the previous Coolify image/SHA. Do not deploy the dirty tree.  
- Workers: matching previous image.  
- Schema: `20261030143000` is additive. Do not DROP columns to undo it.

## Status

**BACKUP AVAILABILITY: NOT VERIFIED**  
**RESTORE DRILL: NOT VERIFIED**  
**AWAITING OWNER APPROVAL** to read the dashboard backup list and, separately, to restore into an isolated project.

# PHASE 3.3 — BACKUP AND RECOVERY

**GATE 4: NOT VERIFIED. PRODUCTION MIGRATION BLOCKED until the operator confirms restore capability.**

Read-only SQL cannot prove PITR, retention, or a restore drill. No dashboard backup export was initiated (would be operational, not a schema mutation, but restore testing is out of scope and must not target production).

## Required before Phase B

Document from the Supabase project dashboard (hgacoeoovjxkzfbesmvl):

- Daily backups on / off  
- PITR available on this plan (do not assume)  
- Retention window  
- Last successful backup timestamp  
- Who can restore, and to **which** project (never restore over production without a named decision)

Recovery tokens expected by the production gate:

`AFFILIATE_PRODUCTION_BACKUP_CONFIRMED=OPERATOR_CONFIRMED_PITR_OR_BACKUP`

That token must be set by a human after they have **seen** backup/PITR evidence. This phase did not set it.

## If a migration fails

STOP. Do not re-run CREATE TABLE blindly. Prefer PITR to a time before the first 20261017 version, or restore a snapshot to a **new** project and cut over only with further approval.

RPO/RTO: **UNVERIFIED**.

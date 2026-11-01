# POSTBUS PHASE 3.2 — MIGRATION EXECUTION

## Remote

**NOT EXECUTED.** Gate: `staging_not_approved`.

`scripts/affiliate-staging-apply.mts` never reached a SQL send path.

Classification: **STAGING_NOT_APPROVED**.

## Local

PGlite via existing Vitest affiliate/billing suites (included in the 14-file / 113-test run). Migration order and object creation: **VERIFIED LOCALLY** in those tests.

Duplicate remote apply handling: **UNVERIFIED** (no hosted `schema_migrations` read).

## Recovery (prepared, not used)

If a future approved apply fails mid-file: STOP. Do not auto-repair. Restore from the staging project backup taken **before** apply. Production is out of scope.

Production checkpoint: no production DDL this phase, so production rollback of affiliate schema is N/A.

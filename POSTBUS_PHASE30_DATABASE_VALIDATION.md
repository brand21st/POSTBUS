# Database validation

PGlite `ledger.pg.test.ts` loads 120000–140000 including 125000. Included in 17 Oct 2026 vitest run (file among 14 that passed 112 tests). Isolation tests are a 15th file.

Hosted Supabase compatibility: UNVERIFIED.

Concurrency: BLOCKED — no docker, no psql.

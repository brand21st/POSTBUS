# Migration dry run

PGlite loaded files 120000 through 140000 including 125000 in `ledger.pg.test.ts` beforeAll. 17 Oct 2026 that file passed as part of 112 tests.

`CREATE OR REPLACE` on summary and partner_records is forward-compatible on a DB that already has 123000/124000.

PGlite vs hosted: PGlite has no PostgREST/RLS JWT plumbing identical to Supabase; tests emulate `auth.uid()` via `request.jwt.claim.sub`. Hosted apply UNVERIFIED.

Disposable Postgres: BLOCKED (no docker/psql).

Do not apply to `hgacoeoovjxkzfbesmvl`.

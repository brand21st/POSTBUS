# PHASE 3.3 — RLS SECURITY REVIEW (PLAN)

Hosted affiliate RLS: **UNVERIFIED** (objects do not exist).

SQL in 120000: enable RLS, revoke anon/authenticated, grant service_role, partner SELECT on own `affiliate_id` / own profile. Accrue/payout/balance execute granted to **service_role** only. `affiliate_create_organization` granted to **authenticated**, `search_path=public`, requires `auth.uid()`.

Public referral must not expose merchant identity: partner records label `Merchant ` + 8 hex chars.

After authorized deploy, hosted checks still need separately approved identities. Do not create production test users now.

PGlite RLS tests exist in `ledger.pg.test.ts`. Not hosted RLS.

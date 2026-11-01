# Environment isolation

`scripts/phase30-env-targets.mts` (hosts only, 17 Oct 2026):

| File | Present | Supabase host | Production? | Affiliates flag |
| --- | --- | --- | --- | --- |
| `.env` | no | | | |
| `.env.local` | yes | hgacoeoovjxkzfbesmvl.supabase.co | yes | unset |
| `.env.development` | no | | | |
| `.env.development.local` | yes | unset | no | true |
| `.env.test` | no | | | |
| `.env.staging` | yes | unset | no | unset |
| `.env.example` | yes | placeholder | no | false (documented) |

Next.js loads `.env.development.local` then `.env.local`. Public Supabase URL therefore remains production. Local affiliate UI flag is on; data APIs hit production and fail closed on missing tables.

Recovery: do not rewrite `.env.local` until a non-production project exists. Copy it aside before any retarget.

Helpers:

- `assertNonProductionMutationTarget` in `lib/env/staging-isolation.ts`
- Existing `assertStagingAuthIsolation` (only when POSTBUS_ENV is staging)
- `scripts/staging/assert-not-production.mjs`
- `scripts/affiliate-staging-gate.mts`

NODE_ENV / ENVIRONMENT alone never authorize writes.

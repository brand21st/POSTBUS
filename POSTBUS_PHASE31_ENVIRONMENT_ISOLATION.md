# Environment isolation

Next.js still loads `.env.local` for `npm run dev`. That file remains production and was **not** overwritten.

Staging selection is explicit: `npm run dev:staging` → `scripts/dev-staging.mts`.

1. Requires `.env.staging.local` (gitignored). Missing → exit 1, no fallback.
2. `assertStagingRuntimeEnv` requires `NEXT_PUBLIC_SUPABASE_URL`, rejects `hgacoeoovjxkzfbesmvl`, rejects `rzp_live_`, rejects payouts and invoice issuance flags.
3. Staging vars are copied into the child `process.env` **before** Next starts so they win over dotenv `.env.local` (Next does not override pre-set keys).
4. Default staging port 3001 so `next dev` on 3000 can keep running.

Helpers: `lib/env/staging-isolation.ts` (`supabaseProjectRefFromUrl`, `parseDotEnvFile`, `assertStagingRuntimeEnv`, `assertNonProductionMutationTarget`).

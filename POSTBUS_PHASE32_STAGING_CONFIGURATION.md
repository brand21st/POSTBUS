# POSTBUS PHASE 3.2 — STAGING CONFIGURATION

Status: **PREPARED**, not executed.

## Scripts (unchanged behavior; no rewrite)

| npm script | File | Observed |
| --- | --- | --- |
| `npm run dev:staging` | `scripts/dev-staging.mts` | Requires gitignored `.env.staging.local`. Injects those keys into the child so Next.js does not silently prefer `.env.local` production values. Missing file → STOP, exit 1. |
| `npm run staging:affiliate-apply` | `scripts/affiliate-staging-apply.mts` | Runs `scripts/affiliate-staging-gate.mts`. On fail prints `STAGING_NOT_APPROVED` and exits. On unexpected gate pass, still exits 2 without sending SQL (Phase 3.1 fail-closed remainder). |
| `npm run build:verify` | `scripts/build-verify.mts` | `POSTBUS_NEXT_DIST_DIR=.next-verify` then `npx next build`. Does not deploy. |

## Required file (does not exist)

Copy `.env.staging.example` → `.env.staging.local` only after an isolated project exists.

Must never set `NEXT_PUBLIC_SUPABASE_URL` to `https://hgacoeoovjxkzfbesmvl.supabase.co`.

## Gate token (current implementation)

`AFFILIATE_STAGING_WRITE_AUTHORIZATION` must equal exactly `AFFILIATE_STAGING_WRITE_APPROVED`.

Also required for a write: `SUPABASE_PROJECT_REF` matching `AFFILIATE_STAGING_PROJECT_REF`, not in production refs, host not production, `POSTBUS_AFFILIATE_STAGING_ENV` empty or `staging` / `affiliate-staging`.

This phase did **not** set those variables.

## Ports / URLs in the example template

`NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001`, `PORT=3001`. India Post bulk flags false in the example.

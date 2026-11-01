# PostBus final release readiness audit

Date: 2026-10-30  
Branch: `fix/auth-session-stability`  
Dirty working tree: **846** porcelain lines. No commit. No push.

## Engineering checks executed this session

| Check | Command | Exit | Notes |
| --- | --- | --- | --- |
| Typecheck | `npm run typecheck` (`tsc --noEmit -p tsconfig.build.json`, 8 GB heap) | 0 | ~23s |
| ESLint | `npx eslint .` | 0 | **0 errors, 57 warnings** |
| Next production build | `npm run build:verify` → `next build` with `POSTBUS_NEXT_DIST_DIR=.next-verify` | 0 | 128.4s; TS 29.6s; 8 GB heap |
| Focused regression | `npx vitest run` 17 files | 0 | **284 passed** |
| Staging proof | `node scripts/staging/e2e-proof.mjs` | 0 | After SQL join fix |

Previous 287 / 186 counts are **not** reused as this session’s evidence.

`npm run build:verify` logged `Environments: .env.local` (production-configured compile on this machine). The artifact was not deployed.

## Staging vs production

- Port 3000 PID **49940** unchanged; no requests sent to 3000.
- Production Supabase ref `hgacoeoovjxkzfbesmvl` not used as a runtime target of 3001.
- Local Postgres `postbus_staging:55432` identity confirmed via `current_database()`.
- App health database = Error (no GoTrue on 54321).

## Migration (SQL, not app)

Official address-normalization columns exist on `public.addresses`. Fixture counts: organizations 3, orders 2, addresses 3, shipments 1. Booked street `Booked House`, barcode `ET214330016IN`. Override tri-state present (NULL / TRUE / empty FALSE). Migration was **not** re-applied this session.

55432 is a **bootstrap** schema (9 tables), not a full production replica. RLS, barcode ranges, and GoTrue are missing. This does **not** independently prove production historical merchant safety.

## Release changeset

Cannot isolate a production release from this working tree.

- `fix/auth-session-stability` contains large unrelated dirty state (hundreds of deleted `app/(auth)` / `app/(admin)` paths vs `app/(site)/…` moves, plus many other modifications).
- This session also added staging runtime identity, `dev-staging` leak hardening, e2e proof script, and booking-idempotency fixture updates.
- `git add .` / `git commit -a` must not be used.
- Packaging: **BLOCKED**.

## This session’s intentional files

Modified: `.gitignore`, `eslint.config.mjs`, `scripts/dev-staging.mts`, `modules/india-post/booking-idempotency.test.ts`  
Added: `app/api/health/runtime/route.ts`, `scripts/staging/e2e-proof.mjs`, reports listed in GO/NO-GO.

## P0 blockers remaining

1. No isolated Supabase Auth/PostgREST; app cannot use 55432.
2. Shopify / address-review / booking HTTP E2E not executed.
3. Release changeset not isolatable.
4. No production backup/target verification this run.
5. Hosted staging never identified.

## Score

**58 / 100** — local compile/test strong; staging application integration incomplete; release packaging blocked.

**PRODUCTION DEPLOYMENT: NO-GO**

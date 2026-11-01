# POSTBUS PHASE 3.2 — PRODUCTION BUILD

Command: `npm run build:verify` → `scripts/build-verify.mts` sets `POSTBUS_NEXT_DIST_DIR=.next-verify` and runs `npx next build`. Output directory is gitignored. Does **not** deploy. Does **not** replace the running `next dev` `.next` cache by design.

## Observed (17 Oct 2026)

Next.js 16.3.8 (Turbopack). Environments: `.env.local` (expected for a local verify; the build still compiles against production-named public env, but writes only to `.next-verify`).

- Compiled successfully (~2.5 min)
- runAfterProductionCompile completed
- TypeScript inside next build finished (~50s)
- Next.js auto-updated `tsconfig.json` `include` to add `.next-verify/types/**/*.ts` and `.next-verify/dev/types/**/*.ts`
- Collecting page data / generating static pages: **96/96** in 9.7s
- Process **exit 0** (~308566 ms). Not deployed.

`npx tsc --noEmit` (CLI, after tracking-effects type fix): **exit 0**.

Hydration / client bundle / pricing toggle on `next start`: **UNVERIFIED** until a dedicated `next start` against `.next-verify` is run. That is not a deploy.

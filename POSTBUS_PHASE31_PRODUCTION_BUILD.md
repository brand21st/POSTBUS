# Production build

`next.config.ts` `distDir` = `POSTBUS_NEXT_DIST_DIR` or `.next`.

`npm run build:verify` → `scripts/build-verify.mts` writes `.next-verify/` so `next dev` can keep `.next`. Gitignored.

**Not executed this phase** to avoid a long competing compile while `npm run dev` is running (pid from terminal 895084). Status: UNVERIFIED. Local production build ≠ deploy.

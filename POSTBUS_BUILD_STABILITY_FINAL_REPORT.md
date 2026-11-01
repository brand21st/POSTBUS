# PostBus build stability — final report

Date: 2026-10-30  
Branch: `fix/auth-session-stability`  
Scope: local only.

## 1. Executive summary

**BUILD VALIDATION COMPLETE**  
**READY FOR STAGING MIGRATION VERIFICATION**

A full Next.js 16.3.8 production build completed with TypeScript checking enabled (`NEXT_BUILD_EXIT=0`). Full application ESLint completed with **0 errors** (56 warnings). `npm run typecheck` (`tsc -p tsconfig.build.json`) passed at an **8 GB** heap cap. Relevant Shopify / address / booking / auth tests: **287 passed**.

This does **not** authorize production deployment. Staging migration and integration smoke tests remain mandatory gates.

## 2. Original OOM root cause

Next.js “Running TypeScript …” used TypeScript’s in-process **incremental Program** after compile, while broad `**/*.ts` includes could also ingest **standalone copies** of app source under `.next-verify/standalone`. Default `tsc --noEmit` (incremental `true` on `tsconfig.json`) still OOM’d at 8 GB; that is a separate path from `next build`.

`.next` holds 8 generated type files. `.next-verify` after a standalone build holds hundreds of copied `.ts` files; only `.next-verify/types` belongs in compilation.

## 3. TypeScript configuration changes

- `tsconfig.json`: explicit `app` / `modules` / `lib` / `components` / `types` / `workers` includes; generated types from `.next/types`, `.next/dev/types`, `.next-verify/types`; exclude standalone/server/static/cache for both dist dirs; exclude `.worktrees`, print-agent trees, tests. `strict` unchanged. `incremental` remains `true` for the IDE.
- `tsconfig.build.json`: `incremental: false`, no Next plugin — used by production typecheck.
- `next.config.ts`: `typescript.tsconfigPath: "tsconfig.build.json"`, `experimental.useTypeScriptCli: true`. **No** `ignoreBuildErrors`.
- `package.json` `typecheck` now runs `tsc --noEmit -p tsconfig.build.json` (same program Next uses).

`npx tsc --noEmit --listFilesOnly -p tsconfig.build.json`: **3424** listed files (2381 `node_modules`, 1043 project-ish, **4** `.next-verify/types`, **0** standalone, **0** `.worktrees`). Application source is compiled once.

## 4. ESLint configuration changes

`eslint.config.mjs` `globalIgnores` now includes `node_modules/**`, `.cursor/**`, `.next/**`, `.next-verify/**`, `.worktrees/**`, `dist/**`, `coverage/**`, `out/**`, `build/**`, print-agent trees, `testsprite_tests/**`. Full `eslint .` no longer walks `.worktrees` (0 worktree files in the JSON report). React Hooks rules were **not** disabled.

## 5. React Hooks errors fixed

55 blocking errors (0 remaining). Classification and approach:

| Class | Count (approx.) | Fix |
| --- | ---: | --- |
| G. State update inside effect (sync props/query → state) | 38 | React 19 adjust-state-during-render when a source key changes; timeout(0) only for DOM/hash, PDF raster, deep-link lookup, expired trial |
| H. Ref access during render | 4 | Assign selection refs in `useEffect`; select-all uses live row model in the click handler |
| I. Compiler / purity / memo | 2 | `Date.now()` moved off first render (`new-order-alerts`); drop `useMemo` that the compiler could not preserve (`shipment-pack-presets`) |
| Other (`prefer-const`, unescaped `"`, `prefer-rest-params`, `.cursor` requires) | 11 | Real edits; `.cursor/**` ignored |

UI/API behavior was preserved: local edits still win until the **source identity/key** changes (query object, URL params, dialog open).

## 6. Files modified (this task)

Config: `tsconfig.json`, `tsconfig.build.json`, `next.config.ts`, `eslint.config.mjs`, `package.json`.

Hooks / lint: admin accounts, login form, webhooks docs, India Post / Wati / invoices / NDR / orders / settings / tracking editor pages; analytics Clarity; billing AI credits; command search, cover studio, data-table, parcel defaults, new-order alerts, order date filter, policies, product AI studio, shell; invoice editor; custom label editor, multi-print, PDF raster preview; order dimension badge, shipment pack presets; store tracking; support workspace; customer track + public tracking gate; `use-india-post-onboarding`; prefer-const in contracts test, WhatsApp lifecycle test, Razorpay admin settings.

Tests: `modules/india-post/booking-dimensions.test.ts` (READY shipping-address fixtures for fail-closed booking).

Reports: this file; earlier `POSTBUS_NEXTJS_BUILD_OOM_FIX_REPORT.md`.

`next-env.d.ts` was restored to `.next/dev/types` after the verify build (Next rewrites it during `next build` / `next dev`).

## 7. TypeScript file count

| | Count |
| --- | ---: |
| `tsc --listFilesOnly -p tsconfig.build.json` | 3424 |
| `node_modules` `.d.ts` | 2381 |
| Project + generated types | 1043 |
| `.next-verify` included | 4 (types only) |
| `.next` types | 8 on disk |
| `modules` / `lib` source (excl. generated trees) | 747 / 262 |

## 8. Before / after memory

| Path | Before | After |
| --- | --- | --- |
| Next “Running TypeScript” | OOM ~16 GB | Finished **16.8s**; full `next build` **exit 0** in **131.1s** under **8 GB** cap |
| `tsc` without build tsconfig (incremental) | Needed 16 GB | Still OOM at 8 GB — **not** used by `next build` or `npm run typecheck` |
| `tsc -p tsconfig.build.json` | n/a | **exit 0**, 8 GB cap, **16.9s** cold / **69.4s** via `npm run typecheck` |
| Prior verify-build peak RSS | ~16 GB fail | ~**4.4 GB** (compile) on the previous instrumented run |

This session’s production build was not RSS-sampled; it completed under `--max-old-space-size=8192` without heap failure.

## 9. Full TypeScript results

| Command | Status | Exit | Duration | Notes |
| --- | --- | --- | --- | --- |
| `npx tsc --noEmit --listFilesOnly -p tsconfig.build.json` | PASSED | 0 | ~8s | Redirected |
| `npx tsc --noEmit --incremental false -p tsconfig.build.json` | PASSED | 0 | 16.9s | 8 GB cap |
| `npm run typecheck` | PASSED | 0 | 69.4s | 8 GB cap |
| `npx tsc --noEmit` (root `tsconfig.json`, incremental) | FAILED (not the build path) | 134 | 46.9s | OOM at 8 GB; IDE config only |

Errors: 0 on the build tsconfig. Strictness unchanged.

## 10. Full ESLint results

| Command | Status | Exit | Duration | Errors | Warnings |
| --- | --- | --- | --- | --- | --- |
| `npx eslint .` | PASSED | 0 | ~36s | **0** | **56** |

Worktrees files linted: 0. Hooks rules remain on.

## 11. Next.js production build results

| | |
| --- | --- |
| Command | `node --max-old-space-size=8192 node_modules/next/dist/bin/next build` with `POSTBUS_NEXT_DIST_DIR=.next-verify` (same compiler as `npm run build` / `npm run build:verify`; isolates output from a running `next dev` `.next`) |
| Status | **PASSED** |
| Exit code | **0** |
| Duration | 131.1s |
| Compile | ✓ 54s |
| TypeScript | Finished 16.8s (checking **on**) |
| Static pages | ✓ 130/130 |
| `BUILD_ID` | `tqKoH-_wqDPuKlLUTKiov` |
| `ignoreBuildErrors` | not set |

Non-fatal: `metadataBase` warnings; Node SQLite experimental warning.

## 12. Regression test results

| Command | Status | Exit | Tests |
| --- | --- | --- | --- |
| Vitest suite (Shopify import/webhooks/address, booking lock/dimensions/safety, labels, auth, RBAC, isolation, date filter) | PASSED | 0 | **23 files, 287 passed**, ~2.0s |

First combined run had 6 failures: two Shopify tests **timed out under concurrent `next build` load** (passed on rerun); four `booking-dimensions` cases lacked `address_validation_status: "READY"` after the fail-closed booking gate (fixtures updated; all 12 booking-dimension tests passed).

## 13. Remaining warnings

- ESLint: 56 warnings (unused vars, exhaustive-deps noise, etc.). Not blocking.
- Next `metadataBase` unset in production metadata.
- `useTypeScriptCli` does not appear in the Next experiments banner; typecheck still ran via `tsconfig.build.json`.

## 14. Remaining blocking issues

None for **build validation**.

Still required before production: hosted staging migration apply, staging identity isolation proof, Shopify/India Post integration smoke. Unrelated dirty working tree on `fix/auth-session-stability` is large and must not be committed as one blob.

## 15. Production readiness impact

Build/typecheck/lint gates for this app are green locally. Compile still peaks several GB (Turbopack + Sentry `runAfterProductionCompile` + 31 workers). Workers and print-agent packages were not modified. No package upgrades.

## 16. Git working tree status

Branch: `fix/auth-session-stability`. Very large uncommitted set remains (prior features + this work). This task did not commit or push.

Touched for this mission include: `eslint.config.mjs`, `tsconfig.json`, `tsconfig.build.json`, `next.config.ts`, `package.json`, many UI/hook files listed above, `modules/india-post/booking-dimensions.test.ts`.

## 17. Confirmation

- No production DB changes
- No production migration
- No production deployment
- No production booking
- No Git commit
- No Git push
- No production environment variable changes

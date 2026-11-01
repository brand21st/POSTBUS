# PostBus Next.js production-build OOM — root cause and fix

Date: 2026-10-30  
Scope: local only. No production deploy, no database migration, no production env changes, no git commit, no git push.

## Confirmed root cause

The production TypeScript step OOM’d because **Next.js ran TypeScript in-process with `incremental: true`** (`createIncrementalProgram`) **after** a large compile, while `tsconfig.json` used glob includes (`**/*.ts` / `**/*.tsx`) that could pull **generated and standalone copies** of the app.

`.next-verify` was **not** the only cause. Standalone `npx tsc --listFilesOnly` already listed **0** `.next-verify` files before this change, and `skipLibCheck` still loads thousands of `node_modules` `.d.ts` files. The failure mode was Next’s **build-time typecheck**, not IDE `tsc` at 16 GB.

Contributing factors:

1. **In-process incremental Program** in Next’s “Running TypeScript …” step (heap grew until kill at ~16 GB).
2. **Broad TypeScript includes** that can ingest extra trees (standalone output, extra dist dirs, tests, scripts).
3. **Two Next output directories** (`distDir` default `.next`, `POSTBUS_NEXT_DIST_DIR=.next-verify` for `build:verify`). After a verify build, `.next-verify` contained **536** `.ts` files (4 generated route types + standalone copies of app source). Including standalone would duplicate the program.

Not used: `typescript.ignoreBuildErrors`. Strictness was not relaxed.

## Versions and config (audit)

| Item | Value |
| --- | --- |
| Next.js | 16.3.8 |
| TypeScript | 5.9.3 |
| `NODE_OPTIONS` (verification) | `--max-old-space-size=8192` (8 GB cap; build did not need 16 GB) |
| `output` | `standalone` |
| `distDir` | `process.env.POSTBUS_NEXT_DIST_DIR \|\| ".next"` |
| Verify script | `npm run build:verify` → `POSTBUS_NEXT_DIST_DIR=.next-verify` |

## Files changed

| File | Change |
| --- | --- |
| `tsconfig.json` | Replaced `**/*.ts(x)` with explicit `app` / `modules` / `lib` / `components` / `types` / `workers` / root Next+Sentry files. Include **only** generated route types: `.next/types`, `.next/dev/types`, `.next-verify/types`. Exclude `node_modules`, standalone/server/static/cache for **both** `.next` and `.next-verify`, plus `.worktrees`, print-agent trees, `scripts`, `tests`, `*.test.ts`. `strict` unchanged; `incremental` remains `true` for the IDE. |
| `tsconfig.build.json` | Extends `tsconfig.json`; `incremental: false`; `plugins: []`. Used only by production typecheck. |
| `next.config.ts` | `typescript.tsconfigPath: "tsconfig.build.json"`; `experimental.useTypeScriptCli: true`. **No** `ignoreBuildErrors`. |
| `eslint.config.mjs` | Ignore `.next-verify/**`, `.worktrees/**`, `print-agent/**`, `print-agent-desktop/**` so lint does not walk generated/duplicate trees. |

`next-env.d.ts` was rewritten by the verify build to `.next-verify/types`. It was restored to `.next/dev/types` so local `next dev` remains the active type source.

## TypeScript file count

`npx tsc --noEmit --listFilesOnly -p tsconfig.build.json` (redirected to a file):

| | Total listed | `node_modules` | Project-ish | `.next-verify` | of which standalone |
| --- | ---: | ---: | ---: | ---: | ---: |
| After fix | 3424 | 2381 | 1043 | 4 (`types` only) | 0 |

On-disk (excludes `node_modules`, `.worktrees`, `.next`, `.next-verify`, print-agent): `modules` 747, `lib` 262. After this verify build, `.next-verify` has 536 `.ts` files; compilation uses **4** of them (generated types).

Prior OOM path listed a similar *tsc* file count (~3528) because `node_modules` `.d.ts` still dominate `listFilesOnly`. The win is **not** dropping lib check; it is **not building a second copy of the app** and **not keeping an incremental Program** during `next build`.

## Memory and duration

| Stage | Result | Duration | Peak working set (process tree) |
| --- | --- | --- | --- |
| Before (production “Running TypeScript”) | OOM / killed | n/a | ~16 GB then fail |
| `tsc --noEmit -p tsconfig.build.json` (8 GB cap) | **exit 0** | ~76 s | under 8 GB cap |
| `next build` with `POSTBUS_NEXT_DIST_DIR=.next-verify`, TypeScript **enabled** (8 GB cap) | **success** (`BUILD_ID=WsiHLw7OreaA7pgbgAkO1`) | ~184 s | **~4,437 MB** (compile); TypeScript finished in **35.5 s** after compile |

`NEXT_BUILD_EXIT` from `Start-Process` was blank on Windows after `HasExited`; the log shows compile success, TypeScript finished, 130 static pages generated, full route table, and `BUILD_ID` on disk. Treated as **exit 0**.

Heap was **not** raised to 16 GB for the passing build.

## TypeScript result

- `npx tsc --noEmit --incremental false -p tsconfig.build.json`: **pass** (exit 0).
- Next “Running TypeScript …”: **Finished TypeScript in 35.5s** (checking on).

## Next.js build result

```
▲ Next.js 16.3.8 (Turbopack)
✓ Compiled successfully in 70s
  Running TypeScript ...
  Finished TypeScript in 35.5s ...
✓ Generating static pages using 31 workers (130/130)
```

Standalone output written under `.next-verify` so a live `.next` dev cache was not overwritten. `typescript.ignoreBuildErrors` was not set.

Non-fatal: `metadataBase` warnings; Node SQLite experimental warning.

## ESLint

- Changed files (`next.config.ts`, `eslint.config.mjs`): **exit 0**.
- Broader `eslint app modules lib components`: **104 problems (52 errors, 52 warnings)** — pre-existing (e.g. `react-hooks/set-state-in-effect`). Not part of this OOM fix; not silenced.

## Shopify regression tests

`npx vitest run` on:

- `modules/shopify/shipping-contact.test.ts`
- `modules/shopify/p0-address-safety.test.ts`
- `modules/orders/address.test.ts`
- `modules/labels/official-address.test.ts`
- `modules/india-post/address-lines.test.ts`

**5 files, 37 tests, all passed** (~4.2 s).

## Remaining issues

1. Repo-wide ESLint still fails on existing React Compiler / hooks rules; CI `npm run lint` is not clean.
2. `next build` compile peaked ~4.4 GB (Sentry `runAfterProductionCompile` + Turbopack + 31 static workers). Further memory work would target **compile / Sentry source maps**, not TypeScript.
3. Default `next build` (distDir `.next`) was not re-run in this session to avoid clobbering `.next`; verify build is the same compiler with a different `distDir`.
4. `useTypeScriptCli` did not appear in the Next “Experiments” banner; typecheck still completed via the configured `tsconfig.build.json` in 35.5 s.

## Success criteria

**Met:** full Next.js production build completed with TypeScript validation enabled (no `ignoreBuildErrors`).

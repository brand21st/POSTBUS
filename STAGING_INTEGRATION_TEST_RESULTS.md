# Staging Integration Test Results

**Date:** 2026-11-01

## Isolation

| Check | Result |
|---|---|
| Host | `127.0.0.1` |
| Database | `postbus_staging` port **55432** |
| Production ref `hgacoeoovjxkzfbesmvl` | **Not used** |
| `INDIA_POST` stub URL | `http://127.0.0.1:4099` (not started for E2E this session) |
| App `127.0.0.1:3001` | **Not running** |
| Supabase API `127.0.0.1:54321` | **Not running** |

Command: `npm run staging:up` — **PASS** (isolated cluster).

## Database / RPC

`node scripts/staging/apply-shopify-compat.mjs` — **PASS**

- Columns present
- RPC replace 2 active same-SKU lines
- Stale deposit snapshot skipped
- Rows: GID 2 and GID 3 only

## Scenarios

| Scenario | Result |
|---|---|
| 1 Partial COD deposit vs replacement | **STAGING PASS** at RPC (active GIDs only). Full Shopify HTTP import **NOT EXECUTED** |
| 2 Fully paid | **UNIT PASS**; staging HTTP **NOT EXECUTED** |
| 3 Normal COD | **UNIT PASS**; staging HTTP **NOT EXECUTED** |
| 4 Edited after booking | **UNIT + PGlite PASS**; live booking **NOT EXECUTED** |
| 5 Concurrent webhook/sync | **PGlite PASS** (single connection); dual `psql` **NOT EXECUTED** |
| 6 New sales invoice | **NOT EXECUTED** |
| 7 Existing invoice | **UNIT** code does not overwrite; staging **NOT EXECUTED** |
| 8 Multi-tenant | **PGlite PASS** |

## India Post mock

`cept-stub` was not left running. No live CEPT. No barcode allocation.

## PostgREST

**NOT EXECUTED.** Staging cluster is Postgres-only. Unknown-column insert via supabase-js against production was not attempted.

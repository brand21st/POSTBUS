# PostBus HMAC E2E, label PDF, backup readiness

Date: 2026-11-01  
Candidate: isolated `release/shopify-address-on-1fd4073` at `80f7dd48440cf9ec9efe1fd6ca68744f62b57be4`  
App under test: Next `127.0.0.1:3002` (build metadata still `1fd4073`, built with address-norm sources)  
Targets: local Docker Auth `54321`, CEPT stub `4099` only  
Not pushed. Not Coolify-deployed. Production SQL not applied.

## Webhook HMAC E2E — `/api/v1/webhooks/shopify`

Script: `scripts/staging/shopify-app-e2e.mjs` (live path, not `/api/shopify/webhooks`).

**41/41 PASS.** Production unused.

| Check | Result |
| --- | --- |
| Missing HMAC | **403** |
| Tampered body | **403** |
| Wrong secret | **403** |
| Valid HMAC, unknown shop | **200** unmatched |
| Valid HMAC `orders/*` import | **200** — partial/paid/COD/line replace/idempotency/stale/booked freeze |
| Address persist | **PASS** — `12 MG Road` / `560001` / `9876543210`; not “Address pending”, `NA`, or `0000000000` |

`SHOPIFY_API_SECRET` was empty in env files. HMAC accept required restarting `:3002` with that secret set in the process environment only (same value as the staging public-app client secret). It was not written into git.

## Label PDF

| Check | Result |
| --- | --- |
| Merchant shipping-label HTTP `POST /api/v1/label-template/custom-download` | **PASS** — `application/pdf`, 1885 bytes, `%PDF-1.7` from booked stub `EY880000012IN` |
| Official CEPT stub `POST .../v1/label/create/domestic` | **PASS** — HTTP 200, `%PDF-1.4` |
| Official generate + `GET /api/v1/labels/{id}/download?raw=1` | **PASS** — 69-byte stub PDF stored and downloaded |
| `POST /api/v1/label-template/preview` after store | **PASS** |

Official India Post PDF is the **local stub** payload, not a live CEPT layout. Merchant packing PDF is a real pdf-lib document. Unicode line wrap for `Ward 4` was already covered in booking E2E.

## Backup / PITR (read-only MCP)

- `list_branches`: `[]`
- Latest production migration: `20261101015108` (`replace_shopify_order_line_items`)
- Address-normalization columns on production: **absent** (`20261030143000` not applied)
- No backup catalog, retention, or recovery timestamp in MCP
- Advisors: pre-existing RLS/search_path/leaked-password lints, not a PITR proof

**BACKUP/RECOVERY: NOT VERIFIED**

## Coolify

**Deploy now: NO.** Confirm dashboard PITR, then production-apply `20261030143000` before pointing Coolify at `80f7dd4`.

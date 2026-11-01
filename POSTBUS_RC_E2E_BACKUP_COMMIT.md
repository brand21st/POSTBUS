# PostBus RC E2E, backup check, and commit

Date: 2026-11-01

## Commit (isolated worktree only)

- Branch: `release/shopify-address-on-1fd4073`
- Path: `D:\POSTBUS-address-norm-1fd4073`
- Parent: `1fd4073c2ba2c67ff76dff84d590327ce5d48f56` (current live Coolify SHA at last audit)
- **Candidate SHA: `80f7dd48440cf9ec9efe1fd6ca68744f62b57be4`**
- Message: Stop fabricating Shopify addresses and fail-closed India Post booking.
- **Not pushed. Not deployed.**
- Dirty `fix/auth-session-stability` tree was not committed.

## Staging E2E (local Docker + candidate Next `:3002`)

Local targets only: Auth/API `127.0.0.1:54321`, Postgres `54332`, CEPT stub `4099`. Production project `hgacoeoovjxkzfbesmvl` was not written.

| Check | Result |
| --- | --- |
| Candidate `/api/health` | api Healthy, database Healthy, `build.commit` `1fd4073…` |
| Auth + RLS (`auth-rls-e2e.mjs`) | **25/25 PASS** |
| Historical NULL classify (`historical-booking-e2e.mjs`) | **20/20 PASS** |
| Stub booking (`release-booking-e2e.mts`) | **PASS** barcode `EY880000012IN`; invalid PIN no barcode; retry same barcode; CEPT stub only |
| Browser password login on `:3002` | **PASS** dashboard Staging Org A |
| Order detail address review | **PASS** invalid order shows “Invalid Shipping Details” / PIN must be six digits |
| Shopify webhook script (`/api/shopify/webhooks`) | **FAIL / INCOMPLETE** — that path 404s on this SHA; live handler is `/api/v1/webhooks/shopify` |
| HMAC smoke on `/api/v1/webhooks/shopify` | **403** (reject) |
| Label PDF render | **PARTIAL** (line wrap in booking script only) |

Local migration `20261030143000` was applied to **Docker `supabase_db_postbuslocal` only** (columns already existed; additive).

Port `:3001` remains the dirty-tree Next process and was not used as the candidate.

## Backup / recovery

Approved APIs: `list_migrations`, `execute_sql`, `get_advisors`, `list_branches`.

- Production address-normalization columns: **absent**
- Latest production migration: `20261101015108` (`replace_shopify_order_line_items`)
- `list_branches`: `[]` (no preview branch / no PITR branch listing)
- No backup catalog, retention, or recovery-point timestamp
- Restore drill: **not performed** (not authorized)

**BACKUP/RECOVERY GATE: NOT VERIFIED**

## Coolify

**Deploy now: NO.** Schema-first still required on production after backup confirmation and owner approval. Auto-deploy must stay off until that SHA is explicitly selected.

## Next

1. Owner confirms PITR/backup in the Supabase dashboard.
2. Point Coolify at `80f7dd4` only after production apply of `20261030143000`.
3. Do not push until asked.

# PostBus address-normalization candidate on live `1fd4073`

Date: 2026-11-01  
Mode: isolated worktree. **No commit. No push. No Coolify deploy. No production SQL.**

## Base

| Item | Value |
| --- | --- |
| Worktree | `D:\POSTBUS-address-norm-1fd4073` |
| Branch | `release/shopify-address-on-1fd4073` |
| HEAD (uncommitted) | `1fd4073c2ba2c67ff76dff84d590327ce5d48f56` |
| Live Coolify SHA this was based on | `1fd4073` (`release/shopify-partial-on-9dcb414`) |
| Dirty primary tree | **not used** |

Live line-item atomic replace, billing capture hardening, and booking auto-retry remain in this tree because the branch starts at live HEAD.

## Changeset (include)

Modified:

- `modules/shopify/orders.ts` — non-fabricating persist via `shopifyAddressPersistence`; no `"Address pending"` / `"NA"` / PIN `padEnd` / `"0000000000"`
- `modules/shopify/shipping-contact.ts` — fail-closed booking block (stored status must be READY, then live fields)
- `modules/orders/historical-classify.ts` — persist required; no skip when column missing
- `modules/orders/service.ts` — classify on manual edit; accept / restore / revalidate; keep `resumeSmartAutoRetryAfterCorrection`
- `lib/api/v1/commerce.ts` — POST address accept/restore/revalidate
- `app/dashboard/orders/[id]/page.tsx` — `AddressReviewPanel`
- `types/api.ts` — address review fields
- tests listed below

Untracked (required):

- `supabase/migrations/20261030143000_shopify_address_normalization.sql` (only new DDL)
- `components/orders/address-review-panel.tsx`
- `modules/shopify/address-ai.ts` (optional OpenRouter; deterministic path still works)
- `modules/shopify/shipping-contact.test.ts`
- `modules/shopify/p0-address-safety.test.ts`
- `modules/orders/historical-classify.test.ts`

## Exclude

- Dirty `fix/auth-session-stability` tree
- `D:\POSTBUS-address-norm-a2169cd` (`a2169cd` base)
- Renamed local migrations `20261007140001`, `20261029120001`, `20261031105000`, `20261031120000`
- Unrelated dirty files

## Isolated verification (this worktree)

| Gate | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.build.json` | PASS |
| ESLint on changed modules (not the pre-existing order-page ref lint) | PASS |
| Vitest 171 tests (address, booking, Shopify orders mapping) | PASS |
| `next build` (Turbopack, Next 16.3.8) | PASS |
| Staging E2E | NOT EXECUTED |
| Production backup/PITR | NOT VERIFIED |
| Committed SHA | NONE |

## Schema-first

Do **not** deploy this app before applying `20261030143000` on production. New inserts write `address_validation_status` and related columns. Production latest migration at last audit was `20261101015108`. Columns were absent.

## Still not a Coolify GO

- Candidate is uncommitted (no reproducible SHA).
- Backup/restore not verified.
- Authenticated staging E2E not run on this SHA.
- Production migration not applied (and must not be applied without backup + owner approval).

**Coolify Deploy now: NO.**

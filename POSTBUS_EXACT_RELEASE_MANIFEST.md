# PostBus exact release manifest

Date: 2026-10-31  
Branch: `fix/auth-session-stability`  
HEAD: `8a52c36`  
Working tree: **dirty (hundreds of paths; prior count 869)**. Not a release SHA.  
**No commit. No push.**

## Include when an approved commit is made

| Path | Why | Risk |
| --- | --- | --- |
| `modules/shopify/shipping-contact.ts` | Stored-field classify and fail-closed booking block | High |
| `modules/orders/historical-classify.ts` | On-demand NULL classify, concurrency-safe write | High |
| `modules/orders/historical-classify.test.ts` | Regression | Low |
| `modules/india-post/booking-run.ts` | Classify before barcode/CEPT | High |
| `modules/india-post/booking-idempotency.test.ts` | NULL valid vs invalid PIN | Low |
| `supabase/migrations/20261030143000_shopify_address_normalization.sql` | Additive schema | High |
| `tsconfig.build.json` | Typecheck/build isolation | Medium |

## Exclude

- `20261007140001_*` and `20261029120001_*` local renames  
- `supabase/config.toml` local ports  
- `.env*`, `.wslconfig`, Docker volumes, `scripts/staging/grant-authenticated-local.sql`  
- Unrelated dirty app files  
- This report set unless the owner wants it in git  

Overlay copy exists at `.worktrees/shopify-address-release`. It was **not** typechecked or built as a clean install in this pass.

## Verdict

**RELEASE PACKAGING: BLOCKED**

# PHASE 3.3 — API INTEGRATION

`/api/partner/[...slugs]`, `/api/partner/register`, `/api/partner/qr`, `/api/affiliate-referral`.

Auth: session, not client affiliate IDs. Origin match on register. Campaign landing allowlist `/`, `/pricing`, `/partner`. Opaque 24-char codes.

Financial summaries: `affiliate_summary` / ledger RPCs via service role in partner API after auth. Frontend must not be the source of balances.

`modules/organizations/service.ts` switches org RPC to `affiliate_create_organization` when the affiliate flag is true. **Do not flip that flag** until 120000 is applied.

Rate limit: existing partner tests stub `limit`. Production soak **UNVERIFIED**.

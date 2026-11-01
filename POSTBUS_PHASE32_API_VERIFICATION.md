# POSTBUS PHASE 3.2 — API VERIFICATION

Partner APIs remain in `app/api/partner/*` and `modules/affiliates/api.ts`. No second affiliate surface.

## Controls verified in code / unit tests (local)

- Session identity, not client-supplied affiliate IDs as authority.
- Same-origin on register (`originsMatch` for localhost / 127.0.0.1 / ::1 same port).
- Campaign POST validates `campaignLinkSchema` (landing path allowlist).
- Opaque public referral codes (24 char); internal UUIDs rejected as public codes.
- Financial mutations are server-side ledger functions, not frontend writes.
- Payouts gated by `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` (must stay off).

## Hosted authorization matrix

**UNVERIFIED ON STAGING.** Cross-affiliate and cross-merchant denial requires hosted RLS + synthetic users after approval.

## Rate limits / CSRF

Existing Next/origin checks apply. Dedicated partner rate-limit soak: **NOT STARTED**.

## Secrets

Service-role key is server-only. Not added to `NEXT_PUBLIC_*` this phase.

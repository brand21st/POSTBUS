# Partner portal security

- RLS from original affiliate migrations unchanged. Authenticated users cannot execute `affiliate_summary` or `affiliate_partner_records`; partner API uses service role after session identity.
- Cross-affiliate: API never accepts client `affiliateId`. Tests in `modules/affiliates/api.test.ts`.
- Cross-origin mutations: localhost and 127.0.0.1 same port allowed. Other hosts rejected.
- Campaign landing restricted to three PostBus paths. External URLs fail Zod parse.
- QR only for session-owned enabled codes.
- Encrypted payout details remain off the partner select list.
- Missing schema is AUTH_UNAVAILABLE, not a leaked PostgREST message with tokens.
- Payout POST remains flag-gated. Accrual is not invoked from partner GET routes.

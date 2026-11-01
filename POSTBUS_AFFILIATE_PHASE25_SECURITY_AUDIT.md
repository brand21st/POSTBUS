# PostBus affiliate Phase 2.5 security audit

## Controls that stayed in place

- Partner APIs take `affiliate_id` from the session profile, not the body.
- Tax insert and other admin mutations go through `affiliate_admin_action`, which requires `platform_admins`, and through the admin PIN in `handleAffiliateAdmin`.
- RLS still lets an authenticated user read only their own partner rows. The PGlite test expects another user's commission count to be 0.
- Financial tables keep the immutability trigger. Tax evidence is insert-only.
- Webhook signatures are unchanged in `app/api/webhooks/razorpay/route.ts`.
- Service-role use stays in server modules. The new classifier is a pure function with no credentials.
- The staging gate prints only `ok` and `reason`. It does not print database URLs or keys.

## Affiliate access

An affiliate cannot insert `affiliate_tax_evidence`. Authenticated grants do not include that table. The partner API has no tax route.

## What this audit did not do

It did not log into hosted Supabase as two real users. Hosted RLS remains UNVERIFIED. PGlite covers the SQL policies with `set local role authenticated`.

Production flags were not read or written.

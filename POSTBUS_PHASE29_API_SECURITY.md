# Partner API security

Catch-all `app/api/partner/[...slugs]/route.ts`.

Auth required except public GET referral. Mutations same-origin via `originsMatch` (loopback alias). Rate 60/min partner, 8/min login, 5/min register.

Identity: `partnerProfile(db, user.id)` only. URL `affiliateId` ignored (`api.test.ts`).

POST payouts blocked when payouts flag off. POST links require APPROVED.

QR owned enabled codes only.

Missing schema mapped to AUTH_UNAVAILABLE without PostgREST body.

Unauthenticated `/api/partner/me` → 401 AUTH_REQUIRED (observed 17 Oct 2026).

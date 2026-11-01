# Partner API

Catch-all: `app/api/partner/[...slugs]/route.ts` → `handlePartnerApi`.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/partner/me` | Session profile, email, settings, payoutsEnabled |
| GET | `/api/partner/summary` | `affiliate_summary` for session affiliate |
| GET | `/api/partner/dashboard` | me + summary (alias) |
| GET | `/api/partner/analytics` | same as dashboard |
| POST | `/api/partner/application` | Insert profile if registration_open |
| PATCH | `/api/partner/profile` | Replace application jsonb |
| GET | `/api/partner/links` | `affiliate_partner_link_stats` or table fallback |
| POST | `/api/partner/links` | Opaque code, optional campaign |
| POST | `/api/partner/campaigns` | Campaign + UTM + landing `/`, `/pricing`, `/partner` |
| GET | `/api/partner/referrals` | `affiliate_partner_records` type referrals |
| GET | `/api/partner/commissions` | type commissions |
| GET | `/api/partner/payouts` | existing request rows only |
| POST | `/api/partner/payouts` | Blocked unless payouts flag |
| GET | `/api/partner/qr` | PNG of owned enabled code |

Auth: `getRequestAuthUser`. Affiliate id always from `partnerProfile(db, user.id)`. Origin: `originsMatch`. Rate limit 60/min. Flag off → 404 before DB.

Register POST still requires password length ≥ 10. Admin login PUT accepts the existing password.

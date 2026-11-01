# POSTBUS PHASE 3.2 — PARTNER PORTAL E2E

Repository routes (no duplicates created):

| Path | Module |
| --- | --- |
| `/partner` | Entry |
| `/partner/login` | Auth |
| `/partner/register` | Registration |
| `/partner/terms` | Terms |
| `/partner/dashboard` | Overview / analytics |
| `/partner/links` | Referral links |
| `/partner/campaigns` | Campaigns |
| `/partner/referrals` | My referrals |
| `/partner/commissions` | Commissions |
| `/partner/payouts` | Payouts (withdrawals disabled) |
| `/partner/profile` | Profile |
| `/partner/support` | Support |

## Classification

| Layer | Status |
| --- | --- |
| Frontend pages | IMPLEMENTED LOCALLY |
| Partner APIs | IMPLEMENTED LOCALLY |
| Auth against production GoTrue | PARTIAL — login works for existing users; affiliate schema missing |
| Dashboard metrics vs affiliate DB | BLOCKED — PGRST205 / `AUTH_UNAVAILABLE` “Partner reporting tables are not installed on this database yet.” |
| Full journey 1–29 (staging E2E) | NOT STARTED — requires staging write approval |
| Mobile / browser QA this phase | UNVERIFIED on isolated production build until `POSTBUS_PHASE32_UI_UX_RESULTS.md` |

Do not treat empty dashboard as “zero commissions” when the schema is missing. The service maps PostgREST missing-table to a distinct unavailable message.

# Full-stack integration map

Partner auth (`PUT /api/partner/register`) → session cookies → `GET /api/partner/me` → `affiliate_profiles`.

Referral: `/?ref=` → `proxy.ts` redirect `/api/affiliate-referral` when flag on → `affiliate_record_click` + signed `pb_referral`. Failure swallowed; home still loads.

Signup: `affiliate_bind_signup` then `affiliate_create_organization` when flag on (`modules/organizations/service.ts`). Unique `organization_id` on attributions.

Payment: existing Razorpay webhook → `payments` → affiliate sweep only if `POSTBUS_AFFILIATE_ACCRUAL_ENABLED`. Tax evidence required before `affiliate_accrue`. Ledger kinds ACCRUAL then APPROVAL after hold_days.

Partner dashboard reads `affiliate_summary` / `affiliate_partner_records` via service role after session identity. Analytics failure is an API error on `/partner/*`; merchant `/dashboard` shipping routes do not call those RPCs.

Failure modes: missing schema → AUTH_UNAVAILABLE message, no merchant booking impact. Tracking RPC error → still redirect `/`. Payout POST → 403 when flag off.

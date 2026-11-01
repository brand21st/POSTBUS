# Partner portal PRD (delta)

This document does not replace `POSTBUS_AFFILIATE_PRD.md`. It records portal product rules that the existing PRD already set, plus UI routes.

## Identity

Same Supabase user as merchant login. Partner data lives on `affiliate_profiles`. Workspace switch: Partner shell link to `/dashboard`, merchant dashboard remains separate.

## Routes

`/partner`, `/partner/login`, `/partner/register`, `/partner/dashboard`, `/partner/links`, `/partner/campaigns`, `/partner/referrals`, `/partner/commissions`, `/partner/payouts`, `/partner/profile`, `/partner/support`, `/partner/terms`.

## Money

INR paise from `affiliate_summary` and `affiliate_partner_records`. Frontend does not sum table rows into a balance. Commission type shown as `recurring` because each captured eligible subscription payment is a new commission row.

## Payouts

Display only. No withdrawal button while `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` is not the string `true`.

## Privacy

Referral table uses attribution labels. No merchant email, phone, Razorpay id, or organization uuid in partner records.

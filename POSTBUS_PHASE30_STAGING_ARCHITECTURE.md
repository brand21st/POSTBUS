# Staging architecture (not created)

Suggested name `postbus-staging`. Actual ID must come from the user.

Required: separate Supabase project, Auth, service role, app URL, Razorpay `rzp_test_` keys, webhook URL not production, synthetic users only.

Must not include: live India Post `app.indiapost.gov.in` booking, production WhatsApp, RazorpayX, production merchant dump.

Affiliate flags on staging, if ever approved: `POSTBUS_AFFILIATES_ENABLED=true` for portal. Accrual only if a test commission is in the approved write scope. Payouts and tax invoice issuance stay false.

This document does not create the project.

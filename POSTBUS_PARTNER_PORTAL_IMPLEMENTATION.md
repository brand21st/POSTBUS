# Implementation notes

Reused: affiliate ledger, summary, partner_records, admin dashboard, register/login APIs, QR, cookie attribution.

Added: partner shell and page routes, campaign schema, link stats RPC, origin helper, clearer missing-schema errors.

Did not add: second ledger, RazorpayX, live notifications, production flags, remote SQL.

`components/affiliates/partner-dashboard.tsx` is superseded by `partner-portal.tsx` for routes. Login/register import Field from the portal file.

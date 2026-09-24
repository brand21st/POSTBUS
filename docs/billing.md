# Billing APIs

All tenant billing routes go through `/api/v1/...` and return `{ success, message, data }`. Super Admin routes go through `/api/admin/...`. Razorpay secrets never appear in responses.

## Customer

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/v1/billing/plans` | Public |
| GET | `/api/v1/billing/subscription` | Member |
| GET | `/api/v1/billing/usage` | Member |
| GET | `/api/v1/billing/payments` | Member |
| GET | `/api/v1/billing/invoices` | Member |
| POST | `/api/v1/billing/subscribe` | OWNER (`org.billing`) |
| POST | `/api/v1/billing/verify` | OWNER |
| POST | `/api/v1/billing/change-plan` | OWNER |
| POST | `/api/v1/billing/cancel` | OWNER |
| POST | `/api/v1/billing/resume` | OWNER |

`subscribe` body: `{ planId, billingCycle: "monthly" \| "yearly" }`.  
Creates a Razorpay **order** for the selected plan price (one-time payment for that period).  
`verify` body: `{ razorpayPaymentId, razorpayOrderId, razorpaySignature }`.

## Super Admin

Requires a `platform_admins` row (or `PLATFORM_ADMIN_EMAIL` matching the signed-in user).

| Method | Path |
| --- | --- |
| GET | `/api/admin/overview` |
| GET | `/api/admin/accounts` |
| GET | `/api/admin/accounts/:id` |
| POST | `/api/admin/accounts/:id/activate\|block\|suspend\|hold\|disable\|delete\|change-plan\|extend\|trial\|reset-usage` |
| GET | `/api/admin/subscriptions` |
| GET | `/api/admin/payments` |
| GET/POST | `/api/admin/plans` |
| PUT | `/api/admin/plans/:id` |
| PATCH | `/api/admin/plans/:id/status` |
| GET | `/api/admin/revenue` |
| GET | `/api/admin/usage` |
| GET | `/api/admin/audit-logs` |
| GET | `/api/admin/razorpay` |
| GET/PATCH | `/api/admin/settings/razorpay` |
| POST | `/api/admin/settings/razorpay/test` |
| POST | `/api/admin/settings/razorpay/webhook` |
| GET/PATCH | `/api/admin/trial-settings` |

Plans with subscribers are archived (`is_active = false`), never deleted. Audit logs have no update/delete API.

## Razorpay

`POST /api/webhooks/razorpay` — HMAC of the raw body with the webhook secret from Super Admin settings (or `RAZORPAY_WEBHOOK_SECRET`). Duplicate `x-razorpay-event-id` values return 200 without applying the payload again.

Checkout uses Razorpay **Orders** (one-time payment for the selected app plan period). `payment.captured` activates the local subscription by `order_id`. Razorpay Subscriptions (`subscription.charged` / `invoice.paid`) can renew a period later if that product is enabled; a second event for the same period is ignored.

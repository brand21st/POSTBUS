# WhatsApp OTP security

PostBus generates the code with a CSPRNG. Only `HMAC-SHA256(OTP_PEPPER, purpose:phone:otp)` is stored. The pepper is separate from `INTEGRATION_ENCRYPTION_KEY` and is read only on the server.

| Control | Value |
| --- | --- |
| Length | 6 digits |
| Expiry | 5 minutes |
| Attempts | 5 wrong codes lock that challenge. The next try is rejected. |
| Resend | 60 seconds. The previous pending or verified challenge for that phone and purpose is invalidated. |
| Phone sends | 5 per 15 minutes |
| IP sends | 10 per 15 minutes |
| Success | Status becomes `consumed` after the session is minted. A second verify fails. |

Rate counters live in `otp_rate_buckets` so they hold across Coolify replicas. Responses stay generic: sent, wait, invalid or expired, too many attempts. Request does not reveal whether the number already has an account.

Audit rows store the event, purpose, last four digits, IP hash, outcome, and error code. They do not store the code, magic-link token, service-role key, or full phone number. Application logs redact fields whose names contain `otp`.

`otp_challenges`, `otp_rate_buckets`, `phone_identities`, and `auth_audit_events` enable row-level security with no policies for `anon` or `authenticated`. Grants are service-role only.

Sending uses the platform VaChat AUTHENTICATION template (`VACHAT_OTP_TEMPLATE_NAME`). Merchant WATI and `sendVachatSessionText` are not used. If VaChat is inactive or the template name is empty, the send fails closed and no session is created.

Do not set `email_confirm: true` for OTP signups. Do not add a unique index on `profiles.whatsapp_number` while duplicate numbers still exist.

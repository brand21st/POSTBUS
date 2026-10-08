# WhatsApp OTP migration

1. Run `scripts/sql/duplicate-whatsapp-phones.sql` (read-only). Resolve duplicates by hand. Keep the organization-bearing or oldest account. Do not auto-merge and do not delete users as a rollback.
2. Apply `supabase/migrations/20261009010000_whatsapp_otp_auth.sql`. It creates the OTP tables and does not unique-index `profiles.whatsapp_number`.
3. Set `OTP_PEPPER` (at least 16 characters) and `VACHAT_OTP_TEMPLATE_NAME` to an AUTHENTICATION template approved on the PostBus WhatsApp number. Leave `AUTH_WHATSAPP_OTP_ENABLED` unset or `false`.
4. On staging, set the flag to `true` only after one template send and verify succeeds. Password login remains available.
5. Production stays off until duplicate numbers are cleared, the template send works, and staging checks pass. Enabling production is a separate approval.

Rollback is `AUTH_WHATSAPP_OTP_ENABLED=false`. Leave the tables. Do not drop `auth.users`, profiles, or password hashes. If a unique phone index is added later and must be undone, drop the index only.

A new OTP account receives a workspace named with the business name through `ensureActiveWorkspace`. An existing membership is not renamed.

# PostBus authentication

PostBus signs merchants in with Supabase Auth. Email and password remain the recovery path and the path for existing accounts, including Super Admin. WhatsApp OTP is an additional sign-in method. It does not replace password login, password reset, or `POST /api/v1/auth/register`.

## Identity

`auth.users` maps 1:1 to `public.profiles`. A workspace is an organization created by `create_organization_for_user` / `ensureActiveWorkspace`. Super Admin is `platform_admins` plus `PLATFORM_ADMIN_EMAIL`.

`profiles.whatsapp_number` is collected at signup and is not, by itself, an authentication factor. `phone_identities` is the canonical map from a normalized `+91` number to one `auth.users` row. Lookup order:

1. `phone_identities`
2. `profiles.whatsapp_number` only when exactly one profile matches

More than one profile for the same number refuses sign-in. No account is chosen automatically.

## Session

OTP verification never returns a service-role key or the code. The server calls `auth.admin.generateLink({ type: "magiclink" })`, then the cookie-bound Supabase client calls `verifyOtp({ type: "magiclink", token_hash })`. `proxy.ts` and row-level security stay as they are.

New WhatsApp accounts are created with `email_confirm: false` and `phone_confirm: true`. The random password is never shown. Email confirmation links are unchanged for password signup.

## Flag

`AUTH_WHATSAPP_OTP_ENABLED` defaults off. With the flag off, login and register keep the email and password forms. Password sign-in stays on the page when the flag is on.

# WhatsApp OTP API

These routes are outside `/api/v1` and do not require a tenant session. They return the standard `{ success, message, data }` envelope. With `AUTH_WHATSAPP_OTP_ENABLED` unset or not `true`, both routes respond `404`.

## POST /api/auth/otp/request

Login:

```json
{ "phone": "9876543210", "purpose": "LOGIN" }
```

Signup:

```json
{
  "phone": "9876543210",
  "purpose": "SIGNUP",
  "name": "Priya",
  "business_name": "Priya Stores",
  "email": "priya@example.com"
}
```

Success (`200`) is the same shape either way:

```json
{
  "status": "sent",
  "challengeId": "uuid",
  "expiresInSeconds": 300,
  "resendAfterSeconds": 60
}
```

Signup fields are stored on the challenge. A later verify does not trust a different name or email from the client. Provider failure does not report the code as sent.

`429` means wait. `422` is a validation problem such as a malformed number.

## POST /api/auth/otp/verify

```json
{
  "challenge_id": "uuid",
  "phone": "9876543210",
  "purpose": "LOGIN",
  "otp": "123456"
}
```

`data.status` is `authenticated` when a session cookie was set, or `complete_profile` when login succeeded and no identity exists yet. Complete the profile with the same challenge and no code:

```json
{
  "challenge_id": "uuid",
  "phone": "9876543210",
  "purpose": "LOGIN",
  "profile": { "name": "Priya", "business_name": "Priya Stores", "email": "priya@example.com" }
}
```

Wrong, expired, replayed, or consumed codes return `Invalid or expired OTP.` A locked challenge returns `Too many attempts. Request a new code.` Duplicate phones and duplicate emails return a support message and do not attach the number to another account.

`POST /api/v1/auth/register` and email/password sign-in stay in place.

# WhatsApp OTP test plan

Automated coverage in `lib/auth/otp/service.test.ts` and `modules/vachat/auth-template.test.ts`:

- HMAC includes purpose and phone. A code for another purpose does not match.
- Five wrong attempts invalidate the challenge. The sixth is locked, including a later correct code.
- Resend invalidates the previous code. A consumed code cannot be replayed.
- The sixth send inside 15 minutes waits. A provider failure invalidates the challenge and does not report success.
- Request does not resolve an account. Login and signup requests share the sent response shape.
- Duplicate profile phones are refused. A signup for an already mapped phone signs that user in and does not create another auth user.
- Signup verify uses the payload stored at request time. A client-supplied email on verify is ignored.
- If session mint fails after create, a retry mints the same user and does not call create again.
- An email that already exists returns a support error and does not link the phone.
- New users are created with `email_confirm: false` and `phone_confirm: true`.
- The migration revokes anon and authenticated access and does not unique-index profile phones.
- The login form still calls `signInWithPassword`. The OTP sender does not call session text or WATI.
- VaChat AUTH sends fail closed when the platform key or template name is missing. A successful call uses `type: "template"`.

Staging, after the template is approved:

- New number, WhatsApp code, dashboard, and a workspace named with the business name.
- Existing password user with one WhatsApp number signs into the same organization.
- Logout and login again.
- A forced VaChat failure creates no user and no session.
- As an authenticated user, `select` on `otp_challenges` returns no rows.

Production flag stays off until those checks pass and duplicate numbers are resolved.

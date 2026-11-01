# POSTBUS AUTH SIGNUP AUDIT REPORT

**Date:** 2026-10-14  
**Priority:** P0  
**Scope:** Read-only code + production Auth/Postgres logs and aggregate SQL  
**Production Auth project:** `hgacoeoovjxkzfbesmvl` (no writes)  
**Live app SHA (Coolify):** `707e81d655162fbe08371f827503c8e4271dc6ba`  
**No deploy, no SMTP change, no user deletion**

---

## 1. Executive summary

New-account failures in the last ~24 hours are **not** explained by missing profiles or a broken `handle_new_user` trigger.

**Confirmed production evidence:**

| GoTrue `POST /signup` (≈24h) | Count |
|---|---|
| HTTP **429** `over_email_send_rate_limit` | **9** |
| HTTP **200** | **8** |

Signup is **failing more often than it succeeds**, and the failure code is **email send rate limit**, not `email_exists`.

Password recovery: **3** × `POST /recover` **429** `over_email_send_rate_limit` vs **1** × 200.

The register API runs `signUp()` **on the Next.js server** (Coolify IP `89.116.34.166`). GoTrue therefore attributes almost all confirmation emails to **one IP / one project email quota** (typically the built-in Supabase mailer). That matches “Email rate limit exceeded” reports.

A second, code-level issue: failed `signUp` errors that are **not** “already exists” are returned to the browser as **raw GoTrue `error.message`** (`VALIDATION_ERROR`). Rate-limit text is not mapped to the app’s `RATE_LIMITED` 429.

Profiles always exist for Auth users (`users_without_profile = 0`). Organization gaps are mostly **unconfirmed** accounts.

---

## 2. Current authentication architecture

```
/register
  ├─ PasswordRegister (default unless AUTH_WHATSAPP_OTP_ENABLED=true)
  │     POST /api/v1/auth/register
  │       in-memory IP limit 8/min (lib/security/rate-limit.ts)
  │       createServerSupabase().auth.signUp({ email, password, user_metadata, emailRedirectTo })
  │       if session: UPDATE profiles (name, whatsapp, pincode, city)
  │       if no session: needsEmailConfirmation
  ├─ WhatsappRegister (flag off by default)
  │     POST /api/auth/otp/request → verify → mint session
  └─ GET /auth/callback  exchangeCodeForSession / verifyOtp
          host-only cookies (Phase 2.6)
          → /dashboard → GET /api/v1/me → ensureActiveWorkspace → create_organization_for_user RPC
```

Provider: **Supabase Auth (GoTrue)** via `@supabase/ssr` cookies. Session gate: `proxy.ts` → `updateSession`. APIs: `getUser()` + `requireTenant`.

---

## 3. Confirmed production errors

**CONFIRMED** (Auth logs, last ~24h, aggregated; no email bodies):

| Path | Status | error_code | n |
|---|---|---|---|
| `/signup` | 429 | `over_email_send_rate_limit` | 9 |
| `/signup` | 200 | (empty) | 8 |
| `/recover` | 429 | `over_email_send_rate_limit` | 3 |
| `/recover` | 200 | | 1 |
| `/verify` | 303 | | 4 |
| `/token` | 400 | `refresh_token_already_used` | 163 |
| `/token` | 200 | | 84 |
| `/token` | 400 | `refresh_token_not_found` | 20 |
| `/token` | 429 | `over_request_rate_limit` | 7 |
| `/token` | 400 | `invalid_credentials` | 7 |
| `/logout` | 204 | | 8 |

**CONFIRMED** Auth event: `user_repeated_signup` on `POST /signup` **200** (duplicate signup treated as success by GoTrue). Referer was the app server (`www.postbus.in` register API).

**CONFIRMED** DB aggregates (no PII):

| Metric | n |
|---|---|
| `auth.users` | 56 |
| Created 7d / 24h | 21 / 2 |
| `email_confirmed_at` null | 8 |
| Users without `profiles` row | **0** |
| Profiles with no `organization_members` | 12 (8 unconfirmed, **4 confirmed**) |

**NOT CONFIRMED in logs:** `email_exists` as a 4xx on `/signup`, `signup_disabled`, `database_error_saving_new_user`, `email_provider_disabled`. Postgres logs had **no** `handle_new_user` / WhatsApp-guard exception matches in this window.

---

## 4. Root cause analysis

### P0 — Email send rate limit (CONFIRMED)

GoTrue refuses to send the confirmation (or recovery) email. `signUp` then returns an error. PostBus maps it to **422 VALIDATION_ERROR** with the provider message unless the message matches `/already|registered|exists/i`.

Causes that are **CONFIRMED in architecture**, not assumed SMTP:

- Server-side `signUp` from Coolify, so GoTrue’s per-IP / project email cap applies to **all** merchants.
- Email confirmation is still required when `data.session` is null (8 unconfirmed users).
- Retries and `user_repeated_signup` can request **another** email.

Default Supabase mailer quotas are low (documented by Supabase as a few emails per hour). **Hosted SMTP settings were not changed and were not read** (would require dashboard/secrets). Treat custom vs built-in SMTP as **UNVERIFIED** until an admin confirms in the dashboard.

### P0 — Duplicate signup UX (CONFIRMED code + LIKELY production)

GoTrue **200** + `user_repeated_signup` does not throw. The API returns `needsEmailConfirmation: true` and “Check your email…”. The customer believes a **new** account was created. Combined with rate limit, the next try is **429**.

If GoTrue instead returns a message matching “already exists”, the UI shows **“An account with this email already exists.”** (enumeration-adjacent, but existing accounts only).

### P1 — Raw provider errors (CONFIRMED code)

`app/api/v1/auth/register/route.ts` lines 35–40: non-conflict errors use `error.message`.

### P1 — Profile update after session signup (LIKELY, not seen in Postgres logs)

If confirm-email is off and a session is returned, the route **UPDATEs** `whatsapp_number`. Trigger `protect_profile_whatsapp_number` blocks **changes**. Same value is allowed. If metadata insert already wrote the number, update is a no-op. **No Postgres matches** in this window → not the current outage.

### P1 — Workspace not created until `/me` (CONFIRMED code)

Register does **not** create an organization. `GET /api/v1/me` → `ensureActiveWorkspace` → RPC `create_organization_for_user`. Unconfirmed users never call `/me` → 8 without org (**expected**). 4 confirmed without org: **LIKELY** never reached dashboard / `/me` failed; RPC failure **UNVERIFIED** (no matching postgres_logs).

### P1 — Session logout (CONFIRMED ongoing)

`/token` 400 `refresh_token_already_used` **163** vs 200 **84** in ~24h (includes pre- and post-`707e81d` deploy). Session hardening shipped; live refresh races **not gone**. Separate from signup P0.

---

## 5. Evidence and log references

- Supabase `auth_logs` aggregate query: `path`, `status`, `error_code` (ClickHouse `logs`).
- `auth.users` / `profiles` / `organization_members` counts via read-only SQL.
- Code: register route, register form, `handle_new_user`, org RPC, WhatsApp update trigger.

No Sentry dump in this audit. No Coolify env dump (would expose secrets). `AUTH_WHATSAPP_OTP_ENABLED` on production: **UNVERIFIED**.

---

## 6. Affected code files and line numbers

| File | Lines | Role |
|---|---|---|
| `app/(auth)/register/register-form.tsx` | 38–68, 145–147 | Password signup; `isSubmitting` disables button (single submit per attempt) |
| `app/(auth)/register/page.tsx` | 4–5 | OTP vs password |
| `app/api/v1/auth/register/route.ts` | 11–67 | `signUp`, error mapping, optional profile update |
| `lib/auth/register-schema.ts` | 4–18 | Email/password/WhatsApp/PIN |
| `lib/auth/urls.ts` | 43–46 | `emailRedirectTo` → `/auth/callback?next=/dashboard` |
| `app/auth/callback/route.ts` | exchange / verify | Email confirm |
| `lib/security/rate-limit.ts` | 4–16 | In-memory 8/min/IP — **not** the 429s in GoTrue |
| `supabase/migrations/20261008150000_profile_pincode_city.sql` | 33–57 | `handle_new_user` |
| `supabase/migrations/20261009021000_protect_profile_whatsapp_number.sql` | 7–39 | Blocks WhatsApp **updates** |
| `lib/api/v1/session.ts` | 19–35 | `/me` provisions workspace |
| `modules/organizations/service.ts` | 68–95, 116–154 | Idempotent org create |
| `app/onboarding/page.tsx` | 21–45 | Manual workspace if `/me` did not |

---

## 7. Supabase configuration findings

| Setting | Status |
|---|---|
| Email confirmation required | **LIKELY on** (`needsEmailConfirmation` path used; 8 unconfirmed; `/verify` 303s) |
| Redirect | Code uses `https://www.postbus.in/auth/callback?next=%2Fdashboard`. Hosted allow-list **UNVERIFIED** (dashboard). One successful `/verify` 303 with that referer → **LIKELY** allow-listed. |
| SMTP | **UNVERIFIED**. 429 `over_email_send_rate_limit` is consistent with **built-in** mailer caps. |
| Signup disabled | **NOT** seen |
| RLS blocking profile insert | **NOT** seen (0 missing profiles; trigger is `security definer`) |

---

## 8. Rate limit investigation

| Layer | Limit | Evidence |
|---|---|---|
| App `POST /api/v1/auth/register` | 8 / 60s / IP, in-memory | Code. **Not** the Auth 429s (those are GoTrue `/signup`). |
| GoTrue email send | Project/SMTP quota | **CONFIRMED** 9 signup + 3 recover 429s |
| OTP | Separate WhatsApp policy | Only if flag on |
| Frontend double submit | Button disabled while `isSubmitting` | **UNLIKELY** as primary cause; React Strict Mode does not double POST in production |

Do **not** raise GoTrue request limits blindly. Do **not** disable confirmation. Safe path: **custom SMTP** (approved) + map 429 to a wait message + avoid extra confirmation emails on repeated signup.

---

## 9. Email verification findings

Successful confirmations exist (`/verify` 303, `user_signedup` on verify). Failures are **send** limits, not callback URL in this sample. Callback messages for `auth_callback_failed` exist on login (`login-form.tsx` 38–44).

---

## 10. Database provisioning findings

Trigger creates `profiles`. Org is **lazy** on `/me`. Retry of `createOrganization` is idempotent (`listMemberships` first). **Do not delete users.** 4 confirmed users without membership need a **support playbook** (open dashboard / `/me`), not a wipe.

---

## 11. Session stability findings

**CONFIRMED** refresh races continue (`already_used` 163 vs token 200 84). Phase 2.6 reduced HTML `getUser` but did not remove all races. Separate from signup P0.

---

## 12. Security risks

- Returning raw GoTrue messages can leak provider internals.
- “Account already exists” on public register is mild enumeration; keep generic copy + login/forgot links.
- Do not expose whether an email is registered on a **new** public lookup API.
- Do not disable RLS or email confirmation.

---

## 13. Recommended fixes (not implemented this audit)

**P0 (code, no Auth dashboard):** Map `over_email_send_rate_limit` / status 429 / “rate limit” to `RATE_LIMITED` and copy: “Too many emails were sent. Wait a few minutes, then try again or sign in.” Do not pass `error.message` through.

**P0 (ops, needs approval):** Confirm SMTP in Supabase dashboard. If using built-in mailer, configure **custom SMTP**. Do not change JWT, rotation, or reuse interval.

**P1:** On `user_repeated_signup` / 200 with no session: “If an account exists, check email or sign in. We cannot send another confirmation yet if you just tried.” Link `/login` and `/forgot-password`.

**P1:** Skip `profiles.whatsapp_number` on the authenticated update (trigger already has metadata from insert).

**P2:** Signup UX, resend cooldown on the client.

---

## 14. Regression testing plan

Staging / mock email only. Tests 1–15 as specified in the incident brief. **Do not** load-test production Auth. Tests 1, 2, 7, 8 are highest for this outage.

| Test | This audit |
|---|---|
| 1 Fresh signup | NOT REPRODUCED (no isolated GoTrue) |
| 2 Existing account | LIKELY (`user_repeated_signup` 200) |
| 3 Unconfirmed | CONFIRMED 8 rows |
| 4 Double click | UNVERIFIED live |
| 5–6 Verify / resend | `/verify` 303 CONFIRMED; resend mixed with 429 |
| 7 After rate limit | CONFIRMED 429 `/signup` |
| 8–10 Org / retry | Code review; 4 confirmed no-org UNVERIFIED cause |
| 11–14 Login/session | `already_used` CONFIRMED |
| 15 Password reset | `/recover` 429 CONFIRMED |

---

## 15. Production deployment plan

1. Ship register error-mapping only (small PR on `release/auth-session-on-prod` or cherry-pick onto live SHA).  
2. SMTP: separate approval.  
3. Do not merge dirty working-tree features.

---

## 16. Rollback

Revert the mapping commit. SMTP rollback is dashboard-only. Do not revoke sessions.

---

## Classification index

| Finding | Class |
|---|---|
| `/signup` 429 `over_email_send_rate_limit` dominates failures | CONFIRMED |
| Register surfaces raw GoTrue messages | CONFIRMED |
| Server-side signUp shares Coolify IP | CONFIRMED |
| Built-in vs custom SMTP | UNVERIFIED |
| `email_exists` as 4xx | NOT REPRODUCED (logs) |
| `user_repeated_signup` 200 | CONFIRMED |
| Missing profiles | NOT REPRODUCED |
| WhatsApp trigger blocking signup | NOT REPRODUCED (this window) |
| 4 confirmed users without org | CONFIRMED count; cause UNVERIFIED |
| Session `already_used` | CONFIRMED |
| Double-submit as primary cause | UNLIKELY |

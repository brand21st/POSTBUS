# 12 SaaS regression

**Classification:** PASS for automated BYO/v1 subset. NOT TESTED for interactive dashboard login. NOT APPLICABLE for CEPT/Razorpay (not invoked).

- `modules/shopify/oauth.test.ts` included in 65 passing tests.
- Cookie gate still `/dashboard`, `/admin`, `/onboarding` only.
- Local `/dashboard` **307**.
- Production Coolify / `www.postbus.in`: not modified.

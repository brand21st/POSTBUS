# 10 Performance and UI report

**Classification:** NOT TESTED for live Admin timings. PASS for static UI review (no fake metrics).

## UI

- Polaris `s-*` on `/shopify`, onboarding, settings.
- Bootstrap shows shop domain, install status, org ready, India Post **read-only** status.
- No fabricated order counts. No Super Admin chrome. No password fields.
- `useAppBridge` authenticated fetch with session retry header.

Live App Bridge hydration, mobile Admin, a11y audit, keyboard nav: BLOCKED / NOT TESTED.

## Performance

No invented benchmarks. Local Vitest duration after hardening: **2.65s** for 12 files (Node, not Admin RTT). Token exchange / bootstrap latency against Shopify: NOT TESTED.

Residual: in-memory refresh lock; unnecessary exchange only when token missing or near expiry (`tokenNeedsRefresh`).

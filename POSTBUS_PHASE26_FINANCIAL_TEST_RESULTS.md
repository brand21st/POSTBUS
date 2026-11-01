# PostBus Phase 2.6 financial test results

Local run on 17 October 2026. No remote SQL and no live Razorpay charge.

`npx vitest run` on the GST unit and PGlite files, affiliate policy, API, reconcile, ledger, referral route, and billing webhooks:

8 files, 89 tests, all passed.

`npx tsc --noEmit --pretty false` exited 0.

## Evidence

| Check | Result |
| --- | --- |
| Catalog gross is unchanged by the splitter | `inclusive-tax.test.ts` |
| 149900 at a fixture 1800 bp rate is 127034 + 22866 | unit and PGlite |
| Commission on that net is 25407 paise | `inclusive-tax.pg.test.ts` |
| Draft policy does not record evidence | PGlite |
| Second apply does not duplicate evidence or commission | PGlite |
| Later policy leaves the stored tax at 22866 | PGlite |
| Conflicting manual tax returns `CONFLICT` and writes no breakdown | PGlite |
| AI credits and a cross-organization payment are `INELIGIBLE` | PGlite |
| Authenticated role cannot read policies or call apply | PGlite |
| Sweep skips accrue when automation returns `CONFLICT` | `reconcile.test.ts` |
| Sweep does not call the tax function while the flag is off | `reconcile.test.ts` |
| Existing affiliate ledger and billing webhook tests | passed in the same run |

The pricing page at `http://127.0.0.1:3000/pricing` showed Starter ₹499.00, Pro ₹1,499.00, and Business ₹3,500.00 per month, with no GST added. The yearly control did not change those amounts during this browser check.

Remote staging and production remain unverified.

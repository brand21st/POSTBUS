# PostBus Phase 2.7 pricing audit

No plan price was changed. The Business price decision remains blocked.

## Authoritative source

The running catalog is `plans.monthly_price_paise` and `plans.yearly_price_paise`. The pricing page and checkout both read those columns. `amountForCycle` returns the stored paise value for the selected cycle. The seed insert is `on conflict (slug) do nothing`, so a later catalog edit is not overwritten by the seed.

The public page at `http://127.0.0.1:3000/pricing` published this JSON-LD on 17 October 2026:

| Plan | Monthly | Yearly |
| --- | --- | --- |
| Starter | ₹499.00 | ₹4,790.40 |
| Pro | ₹1,499.00 | ₹14,390.40 |
| Business | ₹3,500.00 | ₹33,600.00 |

Seed file `supabase/migrations/20260924120000_billing_razorpay.sql`:

| Plan | Monthly paise | Yearly paise |
| --- | --- | --- |
| Starter | 49900 | 479040 |
| Pro | 149900 | 1439040 |
| Business | 550000 | 5280000 |

Business yearly ₹33,600.00 is `350000 * 12 * 0.8`. The seed yearly figure ₹52,800.00 is `550000 * 12 * 0.8`. Starter and Pro match the seed.

## Comparison

| Plan | Database price | Seed price | Frontend price | Checkout price | Billing period | Mismatch | Root cause | Recommended fix |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Starter | ₹499.00 / ₹4,790.40 | ₹499.00 / ₹4,790.40 | Same as database | `amountForCycle` of the stored row | Monthly and yearly | No |  | Leave unchanged |
| Pro | ₹1,499.00 / ₹14,390.40 | ₹1,499.00 / ₹14,390.40 | Same as database | `amountForCycle` of the stored row | Monthly and yearly | No |  | Leave unchanged |
| Business | ₹3,500.00 / ₹33,600.00 | ₹5,500.00 / ₹52,800.00 | Same as database | `amountForCycle` of the stored row | Monthly and yearly | Yes, seed versus catalog | Stale seed. `on conflict do nothing` kept a later catalog edit. | Leave both values. Do not re-run the seed to overwrite the catalog. Confirm the commercial Business price before any edit. |

The frontend does not hardcode ₹3,500 or ₹5,500. There is no second cached price list. Order-limit copy on the page also differs from the original seed and was not changed.

## Business price decision

BLOCKED. This phase does not choose ₹3,500 or ₹5,500.

## Monthly / yearly toggle

The control lives in `PricingToggle`. It stores `monthly` or `yearly` and passes that value to `PlanPicker`. The displayed paise value is `yearlyPricePaise` when the cycle is yearly, otherwise `monthlyPricePaise`. Checkout posts `billingCycle`, and the server prices the Razorpay order with `amountForCycle`.

The yearly amounts are not equal to the monthly amounts. This is not an intentional same-price configuration, and it is not a missing yearly column.

Browser check on `http://127.0.0.1:3000/pricing`:

- Monthly rendered with `aria-pressed=true` and prices ₹499.00, ₹1,499.00, and ₹3,500.00 per month.
- The price nodes exposed `data-billing-cycle=monthly` and `data-price-paise` 49900, 149900, and 350000.
- A click on Yearly focused the button. The DOM stayed on the monthly amounts.
- Headless Chrome against the same dev server showed the same result. The Next.js client set `window.next.turbopack` and consumed the flight payload, but it did not commit a React root, so the button handler never ran.
- A native FAQ `<details>` element did open, which shows the page DOM accepts clicks.
- The GST-inclusive label was absent. `POSTBUS_BILLING_GST_INCLUSIVE_LABEL` is off unless set to `true`.

Interactive yearly and monthly selection is UNVERIFIED. No toggle bug inside `PricingToggle` was confirmed, because the client tree did not hydrate. No annual discount was added and no stored price was edited.

Mobile layout of the toggle was not rechecked. The control markup was not changed beyond `aria-pressed` and the price data attributes.

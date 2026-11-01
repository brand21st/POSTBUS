# PostBus Phase 2.8 pricing verification

Business prices were not edited. The seed still says Business ₹5,500 because of `on conflict (slug) do nothing`. The running page still publishes Business ₹3,500 / ₹33,600. That commercial choice stays BLOCKED. See `POSTBUS_PHASE27_PRICING_AUDIT.md`.

## Executed toggle check

Headless Chrome at `http://127.0.0.1:3000/pricing` after the hydration fix, width 390:

| Selection | Starter | Pro | Business | Label |
| --- | --- | --- | --- | --- |
| Monthly | ₹499.00 | ₹1,499.00 | ₹3,500.00 | `/month` |
| Yearly | ₹4,790.40 | ₹14,390.40 | ₹33,600.00 | `/year` |
| Monthly again | ₹499.00 | ₹1,499.00 | ₹3,500.00 | `/month` |

Those paise values are `49900`, `149900`, `350000` and `479040`, `1439040`, `3360000`. Yearly amounts are annual totals, labeled `/year`. They match `amountForCycle` for the stored plan row. Checkout still posts `billingCycle` and the server prices the order from the plan row. The client does not send an amount.

The GST-inclusive label stayed off. No GST was added on top.

Checkout was not completed. No Razorpay payment was created.

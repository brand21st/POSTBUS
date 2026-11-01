# PostBus Phase 2.6 GST billing audit

Local inspection on 17 October 2026. No production migration, price change, or deploy.

## What the billing path stores

`plans.monthly_price_paise` and `plans.yearly_price_paise` are the amounts sent to Razorpay. `amountForCycle` returns one of those integers. Checkout does not add a tax line.

`payments.amount_paise` stores the captured total. Subscription invoice inserts in `modules/billing/subscriptions.ts` write `amount` and `amount_paise` only. There is no GST, CGST, SGST, or IGST column on `payments` or `invoices`.

The original seed in `supabase/migrations/20260924120000_billing_razorpay.sql` inserts Starter 49900, Pro 149900, and Business 550000 paise. The running local app's pricing page, which reads the connected plan catalog, showed:

- Starter ₹499.00 / month
- Pro ₹1,499.00 / month
- Business ₹3,500.00 / month

Those displayed amounts were left unchanged. The page did not show “+ GST” or “Inclusive of applicable GST”. The inclusive sentence is behind `POSTBUS_BILLING_GST_INCLUSIVE_LABEL`, which is unset.

Shipment invoices in `shipping_invoices` can store a merchant GSTIN. That is not PostBus subscription tax evidence. No platform supplier GSTIN is configured in the billing module.

## Gap

An approved tax policy can now split a gross inclusive amount in integer paise and store a breakdown. Until a super admin approves a rate and place of supply, and until `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` is true, a payment still has no automatic tax evidence and affiliate accrual still returns `TAX_REVIEW`.

## Not confirmed

GST rate, GSTIN, SAC/HSN, whether one place of supply covers every customer, and whether the current `invoices` row is a tax invoice. The yearly toggle on the pricing page did not change the rendered amounts in this browser session, so yearly display was not re-verified in the browser.

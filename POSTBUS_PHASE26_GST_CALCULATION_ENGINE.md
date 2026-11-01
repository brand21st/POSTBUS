# PostBus Phase 2.6 GST calculation engine

Status: verified locally. It does not run against live payments unless tax automation is enabled and an approved policy exists.

## Formula

For an approved single inclusive rate in basis points:

`taxable = (gross * 10000 + divisor / 2) / divisor`

`divisor = 10000 + rate basis points`

`tax = gross - taxable`

All values are integer paise. The half-up step uses integer division. Taxable plus tax equals gross, or the result is `REVIEW_REQUIRED` and nothing is stored.

Intra-state tax is split by giving CGST `tax / 2` and SGST the remainder, so an odd paise stays on SGST. Inter-state tax is IGST. An explicit zero-rated policy stores tax 0 and taxable equal to gross. A missing policy does not store zero.

## Test fixture only

Gross 149900 paise at 1800 basis points:

- taxable 127034
- tax 22866
- 127034 + 22866 = 149900
- 20 percent commission on that net, using `commissionPaise`, is 25407 paise

The same fixture rate also reconciles 49900, 550000, and the seed yearly amounts. A 500 basis-point policy produces a different tax amount. These rates are not production configuration.

`POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` defaults off. Checkout still charges `amountForCycle`.

# PostBus Print Agent — test plan

## Automated

Add tests beside `modules/print/service.test.ts` and a pairing module test file. Do not require a physical printer for these.

| Case | Expect |
| --- | --- |
| Pairing happy path | Code redeemed once, credential issued only with device proof |
| Expired code | Reject |
| Second redeem | Reject |
| Wrong organization member without `automation.manage` | Forbidden |
| Revoked credential | Heartbeat and claim return auth required |
| Claim job from another org | Not found, no PDF bytes |
| Two agents claim one job | One `PRINTING`, the other gets a different job or null |
| Double click same idempotency key | One job |
| Stale `PRINTING` with `spooler_submitted_at` | `UNKNOWN`, not `PENDING` |
| Stale `PRINTING` before submit | `PENDING` |
| Non-PDF bytes | Download rejected |
| Label id outside the selection | Not enqueued |
| WebUSB job | Agent claim skips it |
| Auto print flag off | Label generation does not enqueue |

Printer enumeration tests can mock the Win32 list. A CI job on Linux asserts the module returns an empty list or a clear unsupported error rather than crashing the Next.js app.

## Manual hardware

On Windows 10 or 11, with the staging app:

1. USB thermal printer with its vendor driver installed. Direct print an India Post label. Barcode scans. Malayalam, Hindi, and Tamil addresses stay readable.
2. A4 printer. Same PDF, actual size, no clipped barcode.
3. Unplug the printer mid-queue. Remaining jobs fail or wait. Already submitted jobs do not reprint by themselves.
4. Kill the agent after the spooler accepts a job and before the status call. Job becomes `UNKNOWN`. A person must choose reprint.
5. Restart Windows. Paired agent reconnects without a password.
6. Revoke in the dashboard. Agent returns to the pairing screen.
7. Browser Print still downloads or opens the PDF with the agent offline.
8. Book a shipment and sync a Shopify order. Neither flow changes.

Do not publish a printer compatibility list from this plan. Record the exact models that passed.

# Production readiness gates

| Gate | Result |
| --- | --- |
| 1 Local automated tests | PASS 14 files / 112 tests + tsc 0 |
| 2 Browser interactions | PARTIAL (pricing pass; partner data blocked) |
| 3 API authorization | PASS unit; hosted PARTIAL |
| 4 Staging migrations | BLOCKED not approved |
| 5 Hosted RLS | BLOCKED |
| 6 Razorpay test-mode hosted | BLOCKED |
| 7 Tax evidence → one commission | PASS PGlite; hosted BLOCKED |
| 8 Duplicate webhook | PASS local webhook + accrue once PGlite |
| 9 Hold/release | PASS PGlite |
| 10 Refunds | PASS PGlite |
| 11 Partner balances | PASS PGlite summary/balance; hosted BLOCKED |
| 12 Invoice security | PASS unit; issuance off |
| 13 Cross-tenant | PASS PGlite; hosted UNVERIFIED |
| 14 Business ₹3500 vs seed ₹5500 | UNRESOLVED, both left |
| 15 Tax/invoice policy for enablement | Issuance and accrual flags stay off |
| 16 Flag rollout | Documented; production not changed |
| 17 Deploy/recovery | NOT STARTED |
| 18 Production migrate/deploy | NOT GRANTED |

Affiliate system is not production-ready.

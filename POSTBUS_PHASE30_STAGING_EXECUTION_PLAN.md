# Staging execution checkpoint

1. Staging project reference: **not supplied**  
2. Staging hostname: **unknown**  
3. Proof not production: **fail** (local app uses hgacoeoovjxkzfbesmvl)  
4. Exact files: see `POSTBUS_PHASE30_MIGRATION_INVENTORY.md`  
5. Privileges: service role / postgres on staging only  
6. Staging migration history: **unknown** (no connect)  
7. Objects: affiliate_* , tax policy, tax invoices, webhook lease columns  
8. Planned data writes: none this phase  
9. Synthetic data: none this phase  
10. Flags to change: none on production; staging flags only after approval  
11. Razorpay: rzp_test_ only, not connected  
12. Recovery: restore staging snapshot; do not reverse production  
13. Risk: webhook lease ALTER on payments infra if mis-targeted  
14. Verification tests: gate, hosted RLS plan, partner E2E  
15. User approval: **absent**

**STAGING_NOT_APPROVED.** STOP REMOTE EXECUTION.

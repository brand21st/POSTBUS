# PHASE 3.3 — DEPLOYMENT PLAN (NOT EXECUTED)

Conceptual order (must be re-approved in Phase B):

1. Operator confirms backup/PITR; names window and operator id.  
2. Production gate env set by operator (not by the agent).  
3. Apply eight SQL files **in inventory order** via approved procedure (Supabase migration history).  
4. Verify `to_regclass` for affiliate tables, `claim_razorpay_webhook`, RLS enabled.  
5. Keep **all** affiliate/financial flags **false**.  
6. Deploy application only if it remains compatible with flags off (webhook skips claim RPC).  
7. Smoke: merchant login, billing dashboard, India Post health, webhook 2xx.  
8. Separate approval for `POSTBUS_AFFILIATES_ENABLED=true`.  
9. Separate approval for accrual.  
10. Payouts later phase.

`npm run production:affiliate-gate` / `production:affiliate-apply` evaluate the gate. The apply script **does not send SQL**.

Do not use `npm run staging:affiliate-apply` against production (that gate **rejects** `hgacoeoovjxkzfbesmvl`).

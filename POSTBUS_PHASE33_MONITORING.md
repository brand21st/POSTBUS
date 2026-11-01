# PHASE 3.3 — MONITORING PREP

Use existing `logError` paths (`razorpay.webhook_failed`, webhook store failures). Partner schema-missing uses `AUTH_UNAVAILABLE` — treat as a **deploy invariant**, not a zero dashboard.

Watch after any future schema apply (still not done):

- Webhook 5xx rate  
- `claim_razorpay_webhook` missing (503)  
- Partner API 404 vs 409 vs AUTH_UNAVAILABLE  
- Org create RPC errors if flag flipped early  
- Deadlocks on `FOR UPDATE` of webhook/affiliate rows  

Do not log passwords, service-role keys, Razorpay secrets, bank details.

Owners: unassigned until Phase B names an operator (`AFFILIATE_PRODUCTION_OPERATOR`).

# Staging readiness

STAGING_NOT_APPROVED.

Gate output: `{"ok":false,"reason":"staging_not_approved"}`.

Enhanced checks (local code): production hostname `hgacoeoovjxkzfbesmvl` / www.postbus.in, environment name, write token `AFFILIATE_STAGING_WRITE_AUTHORIZATION=AFFILIATE_STAGING_WRITE_APPROVED`. ENVIRONMENT=staging alone is not enough.

Approval request (user must supply later):

1. Isolated Supabase project ref ≠ hgacoeoovjxkzfbesmvl  
2. Confirmation it is not production  
3. Permission to apply 20261017120000–25000 then tax 130000–140000  
4. Test Razorpay keys and staging app URL  
5. Write scope: schema only or schema+synthetic data  

Until then: no remote SQL, no staging flags, no webhooks to production.

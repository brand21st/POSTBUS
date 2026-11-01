# 11 Shopify development store test checklist

**Status:** Prepared. **No external mutations executed.**

Shopify CLI on this machine: **3.90.0** (`shopify version` only). Newer 4.8.5 is available; do not upgrade as part of an unauthorized deploy.

## Safe now (already done)

```
shopify version
```

Do **not** run without a later written approval:

- `shopify app dev`
- `shopify app deploy`
- `shopify app config link` / `--reset`
- Partner webhook registration against production
- Any command that creates tunnels or rewrites `shopify.app.toml` `client_id`

## Later (after explicit Stage D approval)

1. Create a **new** Partner app named distinctly from the BYO connector. Copy client ID/secret into **gitignored** `.env.local`:
   - `SHOPIFY_PUBLIC_APP_CLIENT_ID`
   - `SHOPIFY_PUBLIC_APP_CLIENT_SECRET`
   - `SHOPIFY_EMBEDDED_APP_ENABLED=true` (**local only**)
2. Replace `REPLACE_WITH_PARTNER_APP_CLIENT_ID` in a **local uncommitted** toml or use CLI config for that app. Do not commit secrets.
3. HTTPS `application_url` (Cloudflare tunnel / `shopify app dev` preview) pointing at `/shopify`.
4. Apply migration to a **non-production** database (ref ≠ `hgacoeoovjxkzfbesmvl`).
5. Register webhooks to `https://<dev-host>/api/shopify/webhooks` (not `/api/v1/webhooks/shopify`).
6. Install on a **development store** you name in the approval note.

## Manual tests 01–25 (all BLOCKED until Stage D)

01 Install public app  
02 Open PostBus in Admin  
03 App Bridge init  
04 Shop identity  
05 ID token  
06 Org provision  
07 Refresh  
08 In-app navigation  
09 Close/reopen  
10 Session recovery  
11 No separate PostBus login  
12 Browser console  
13 CSP headers  
14 Mobile layout  
15 Invalid token rejected  
16 Webhook reception  
17 Uninstall  
18 Install deactivated  
19 Reinstall  
20 Safe org resolution  
21 No duplicate install  
22 No privilege escalation  
23 Flag rollback  
24 BYO isolation  
25 Compliance webhook handling  

Record PASS/FAIL only from a real Admin session.

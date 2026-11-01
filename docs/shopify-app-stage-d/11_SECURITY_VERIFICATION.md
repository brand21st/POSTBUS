# 11 Security verification

**Classification:** PASS for local gates. FAIL for current `.env.local` database target. BLOCKED for live Admin.

| Control | Result |
|---------|--------|
| Production migrate | Not run (PASS) |
| Current env ≠ production | FAIL — `.env.local` uses ref `hgacoeoovjxkzfbesmvl` |
| Flag off in this process | PASS (`/shopify` 404) |
| Dashboard still 307 | PASS |
| BYO HMAC mix | Unit tests PASS; CLI `SHOPIFY_API_KEY` injection not used |
| Secrets in chat | Not requested / not printed |
| CSP unit matrix | PASS (vitest headers) |
| Live tenant isolation on tuzzstore | BLOCKED |

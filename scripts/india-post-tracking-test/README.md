# India Post Tracking API diagnostic

Isolated, read-only CEPT session/tracking probe. It does not change PostBus authentication, tracking jobs, database rows, or production integrations.

## What it tests

1. VPS egress IP vs `INDIA_POST_EXPECTED_EGRESS_IP` (fail closed on mismatch)
2. DNS + TLS to the configured CEPT host (verification stays enabled)
3. `POST /v1/access/login`
4. Access / refresh / ID token presence and `expires_in` fields
5. `POST /v1/access/TokenWithRtoken` when a refresh token exists (PostBus AUTH02; the approach document returns a refresh token but does not list this URL)
6. `GET /v1/pincode-search` control call
7. TNT02: `POST /v1/tracking/bulk` with `{ "bulk": ["<barcode>"] }` (`npm run test:india-post-tracking`)
8. TNT01: `GET /v1/tracking/{barcode}` path parameter (`npm run test:india-post-tnt01`) — does not call TNT02
9. One fresh-login retry if tracking returns HTTP 403

## Production vs documentation hosts

| Environment | Host |
| --- | --- |
| Production (required for live customer credentials) | `https://app.indiapost.gov.in/beextcustomer` |
| Documented UAT/test only | `https://test.cept.gov.in/beextcustomer` |

Do not send production credentials to the test host.

## VPS-only execution

CEPT may whitelist a single outbound IP. PostBus production egress is `89.116.34.166`.

```bash
# On the VPS, from the PostBus app checkout:
cp scripts/india-post-tracking-test/.env.example scripts/india-post-tracking-test/.env
# edit .env — never commit it
npm run test:india-post-tracking    # TNT02 bulk only
npm run test:india-post-tnt01       # TNT01 single article only
npm run test:india-post-authz       # AUTH01/02 + PIN + TNT01 + TNT02 + JWT claim inspect
```

The process refuses live CEPT calls if the observed IPv4 is not `INDIA_POST_EXPECTED_EGRESS_IP`.

## Credentials

Use the India Post CEPT customer username and password (`INDIA_POST_USERNAME` / `INDIA_POST_PASSWORD`). That is not the PostBus dashboard login unless they happen to be the same. `INDIA_POST_CUSTOMER_ID` is recorded only for diagnostics.

## Output

Console report plus `india-post-tracking-diagnostic-report.json` in this directory. Tokens and passwords are never written.

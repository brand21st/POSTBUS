# India Post tracking authorization diagnostic

Generated: 2026-10-21T18:09:37Z (VPS run; role-extraction rerun immediately after)  
Classification: diagnostic only. PostBus production code, Coolify, networking, and shipments were not changed.

## 1. Executive Summary

A valid production session for customer `1392911671` can authenticate, refresh, and call PIN Code Search. The same access token is rejected on TNT01 and TNT02 with HTTP 403 `You are not authorized to access this API`.

The India Post dashboard shows TNT01 and TNT02 as **Already Subscribed**. That is operator evidence of a portal subscription. It does not prove that the production gateway has mapped those subscriptions onto the Keycloak client and token used here.

**Strongest evidence-supported explanation (not confirmed):** the access token is a Keycloak `external_client` Bearer for realm `customer-portal` with only default OIDC scopes (`openid profile email`) and default account roles. No tracking-specific scope or resource role appears in the token. PIN search is entitled for this identity; TNT01/TNT02 are not, at the API-authorization layer, before any article payload is returned.

Token expiry is **ruled out**.

## 2. Test Environment

| Item | Value |
| --- | --- |
| Host | `https://app.indiapost.gov.in/beextcustomer` |
| VPS egress | `89.116.34.166` (matches expected) |
| Proxy | none |
| TLS | verified (TLSv1.3) |
| DNS | `app.indiapost.gov.in` → `45.127.75.252` |
| Customer ID / login username | `1392911671` (match) |
| Barcode | `CX075364959IN` |
| Client | Node `fetch`, no interceptors |

## 3. API Subscription Evidence

Operator screenshots (not fetched from the portal by this tool):

| API | Method | Dashboard path | Dashboard status |
| --- | --- | --- | --- |
| AUTH01 | POST | `{base}/v1/access/Login` | Already Subscribed |
| AUTH02 | POST | `{base}/v1/access/TokenWithRtoken` | Already Subscribed |
| TNT01 | GET | `{base}/v1/tracking/` | Already Subscribed |
| TNT02 | POST | `{base}/v1/tracking/bulk` | Already Subscribed |

CUSTOMER_APPLICATION_MAPPING: **NOT VERIFIED**

## 4. Authentication Results

| Test | Result |
| --- | --- |
| AUTH01 `POST /v1/access/login` | HTTP 200 |
| AUTH02 `POST /v1/access/TokenWithRtoken` | HTTP 200 |
| `expires_in` | 1800 (API) |

Dashboard shows `/access/Login`. This diagnostic used lowercase `/access/login`, which is the documented and production-working path. AUTH01 succeeded, so login-path casing is not the tracking 403 cause.

## 5. Token Diagnostics

Local unsigned JWT decode only. Signature was **not** verified.

| Field | Access token |
| --- | --- |
| Format | JWT (RS256, `kid` present) |
| `iss` | `https://app.indiapost.gov.in/idam/realms/customer-portal` |
| `aud` | `account` |
| `azp` | `external_client` |
| `typ` | `Bearer` |
| `preferred_username` | `1392911671` |
| `sub` | Keycloak UUID (not the customer ID) |
| `scope` | `openid profile email` |
| `realm_roles` | `default-roles-customer portal`, `offline_access`, `uma_authorization` |
| `resource_roles` | `account`: `manage-account`, `manage-account-links`, `view-profile` |
| Tracking scopes/roles in token | **none observed** |
| Expired at inspection | false |

Refresh token: JWT HS512, `typ=Refresh`, same `azp=external_client`.  
ID token: JWT RS256, `aud=external_client`, `preferred_username=1392911671`.

## 6. Request Format Verification

| API | Request used | Source |
| --- | --- | --- |
| TNT01 | `GET /beextcustomer/v1/tracking/CX075364959IN` | Dashboard prefix `/v1/tracking/` + barcode as **path** parameter (PostBus CEPT stub and prior TNT01 provider tests). Approach document does **not** specify TNT01. |
| TNT02 | `POST /beextcustomer/v1/tracking/bulk` body `{"bulk":["CX075364959IN"]}` | Approach document sample. |

No undocumented path probing was performed.

## 7. Header Comparison

| Call | Method | Request headers | Authorization |
| --- | --- | --- | --- |
| PIN search | GET | `authorization` | PRESENT, Bearer, ACCESS_TOKEN, HTTP 200 |
| TNT01 | GET | `authorization` | PRESENT, Bearer, ACCESS_TOKEN, HTTP 403 |
| TNT02 | POST | `authorization`, `content-type: application/json` | PRESENT, Bearer, ACCESS_TOKEN, HTTP 403 |

PIN and TNT01 send the same header set. No API key, subscription key, or client-id header is documented in the approach document. None was invented or sent.

No correlation / request ID was returned (`x-request-id` / `x-correlation-id` absent). Response `Date`: `Wed, 21 Oct 2026 18:09:36 GMT` (retries `18:09:37 GMT`).

## 8. API Test Results

| Test | HTTP | Duration | UTC |
| --- | --- | --- | --- |
| AUTH01 | 200 | — | 2026-10-21T18:09:36Z |
| AUTH02 | 200 | — | 2026-10-21T18:09:36Z |
| PIN search | 200 | 66 ms | 2026-10-21T18:09:36.761Z |
| TNT01 | 403 | 52 ms | 2026-10-21T18:09:36.828Z |
| TNT02 | 403 | 47 ms | 2026-10-21T18:09:36.881Z |
| Fresh login | 200 | — | 2026-10-21T18:09:37Z |
| TNT01 retry | 403 | 39 ms | 2026-10-21T18:09:37.288Z |
| TNT02 retry | 403 | 41 ms | 2026-10-21T18:09:37.327Z |

TNT01/TNT02 body (all four tracking calls):

```json
{ "success": false, "error": { "message": "You are not authorized to access this API" } }
```

## 9. Gateway Response Analysis

- Same host, TLS, and egress IP for working and failing calls.
- Tracking latency is ~40–50 ms, similar to PIN (66 ms): failure is an authorization decision, not a timeout.
- Identical 403 text on TNT01 and TNT02, including after fresh login.
- No article payload, so barcode-level results were not evaluated in the response.
- Helmet-style security headers are present on both PIN and tracking; they do not distinguish the 403.

## 10. Root Cause Hypotheses

| ID | Hypothesis | Status | Confidence | Evidence |
| --- | --- | --- | --- | --- |
| H1 | Tracking entitlement not active on the production gateway | **SUPPORTED** | Medium-high | Identical API-level 403 on TNT01 and TNT02; PIN entitled. Dashboard subscription is not a gateway proof. |
| H2 | Subscription mapped to a different application identity | **SUPPORTED** | Medium | Token `azp=external_client`. Portal “Already Subscribed” mapping to that client is **NOT VERIFIED**. |
| H3 | Missing tracking-specific role or scope | **SUPPORTED** | Medium-high | Token `scope` is only `openid profile email`. Realm/resource roles are Keycloak defaults (`account` manage/view). No TNT01/TNT02 role observed. |
| H4 | Additional documented tracking headers required | **RULED OUT** for documented headers; extra undocumented headers **NOT VERIFIED** | High / n/a | Approach document specifies Bearer only. PIN and TNT01 use the same request headers. |
| H5 | Incorrect TNT endpoint or parameter format | **RULED OUT** for TNT02; **NOT VERIFIED** for TNT01 path vs other undocumented variants | High / low | TNT02 body matches the approach document and still 403. TNT01 path format is the only verified schema in this repo; the approach document omits TNT01. |
| H6 | Article not accessible under this customer | **POSSIBLE** | Low | Possible in general, but CEPT says “this **API**”, both TNT01 and TNT02 fail identically, and no article payload is returned. |
| H7 | Independent IP restriction on tracking | **POSSIBLE** | Low | Same VPS IP succeeds for PIN and AUTH. A tracking-only IP ACL is not disproven, but is weaker than identity/entitlement. |
| H8 | Internal gateway authorization defect | **POSSIBLE** | Low | Compatible with 403, not distinguishable from H1–H3 without CEPT logs. |
| H9 | Misleading 403 for another validation failure | **POSSIBLE** | Low | Same canned message on GET and POST; still possible. |

No hypothesis is **CONFIRMED**. H1+H2+H3 together are the strongest supported cluster: **the portal subscription is not reflected in this token’s Keycloak client/roles, and the production tracking routes reject that identity.**

## 11. Confirmed Findings

- AUTH01, AUTH02, PIN search succeed from `89.116.34.166`.
- TNT01 and TNT02 return HTTP 403 with the same error after a fresh token.
- Access token is a Keycloak JWT for `preferred_username=1392911671`, client `external_client`.
- Token expiry is not the cause.
- PostBus production application was not modified.

## 12. Unverified Findings

- Whether dashboard TNT01/TNT02 subscriptions are bound to Keycloak client `external_client`.
- Whether TNT01 requires a query parameter instead of a path (no official TNT01 schema in the approach document).
- Contents of CEPT gateway policy / API product assignment.
- Barcode ownership for `CX075364959IN` (not reached if API authorization fails first).

## 13. Questions for CEPT

See section 15.

## 14. Recommended Next Steps

1. Send the CEPT package below. Do not change PostBus tracking or auth code for this 403.
2. Ask CEPT to bind TNT01/TNT02 to client `external_client` (or name the correct client) and to the user `1392911671`.
3. After CEPT confirms mapping, re-run `npm run test:india-post-authz` on the VPS.
4. Only then consider production tracking changes.

## 15. CEPT support package

To: India Post CEPT integrations  
Re: Production tracking 403 for customer 1392911671 despite dashboard “Already Subscribed”

Customer ID: `1392911671`  
Production VPS IP: `89.116.34.166`  
Production host: `app.indiapost.gov.in`  
Keycloak realm (from unsigned access-token `iss`): `customer-portal`  
Token authorized party (`azp`): `external_client`  
Token preferred_username: `1392911671`  
Token scopes observed: `openid profile email`  
Dashboard: TNT01 Already Subscribed; TNT02 Already Subscribed  

Observed from the same process, 2026-10-21 18:09:36–18:09:37 UTC:

- AUTH01 POST `/beextcustomer/v1/access/login` → 200  
- AUTH02 POST `/beextcustomer/v1/access/TokenWithRtoken` → 200  
- GET `/beextcustomer/v1/pincode-search?pincode=110001&office-type=post` → 200  
- GET `/beextcustomer/v1/tracking/CX075364959IN` → 403  
- POST `/beextcustomer/v1/tracking/bulk` `{"bulk":["CX075364959IN"]}` → 403  
- One fresh login, then both tracking calls retried once → still 403  

Error body: `{ "success": false, "error": { "message": "You are not authorized to access this API" } }`  
No `x-request-id` / correlation ID was returned.

Please verify:

1. Production gateway subscription mapping for TNT01 and TNT02  
2. Customer-to-application mapping for `1392911671`  
3. Token-to-application mapping for Keycloak client `external_client`  
4. TNT01/TNT02 authorization policies  
5. Required tracking-specific roles or scopes (none appear on this token)  
6. Any required additional gateway headers (none are documented; we send Bearer only)  
7. Correct TNT01 request schema (we used GET `/v1/tracking/{barcode}`)  
8. Whether barcode ownership is evaluated before or after endpoint authorization  

Passwords and tokens are not included.

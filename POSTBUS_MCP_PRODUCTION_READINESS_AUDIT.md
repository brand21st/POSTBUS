# POSTBUS MCP PRODUCTION READINESS AUDIT

**Product:** PostBus — India Post shipping automation SaaS (`https://www.postbus.in`)
**Subject:** POSTBUS AI CONNECT — remote MCP for authorized merchants
**Mode:** Read-only static audit. No code, schema, environment, booking, label, payment, or deployment changes were made.
**Verification date:** 19 October 2026
**Tests executed for this audit:** none. Conclusions are from source inspection and official documentation fetched on that date.
**Proposed endpoint (does not exist):** `https://mcp.postbus.in/mcp`

Evidence labels: **VERIFIED**, **PARTIALLY VERIFIED**, **UNVERIFIED**, **NOT IMPLEMENTED**, **NOT APPLICABLE**.

---

## 1. Executive Summary

PostBus is a Next.js 16 App Router monolith on a long-running Node process (Coolify Docker), with Supabase Auth, membership RLS, application RBAC, a service layer for orders, shipments, tracking, tariffs, labels, and analytics, plus a separate hashed-key Merchant API. That service layer is the correct place for MCP tools to call. It is not safe to expose those services to ChatGPT, Claude, or Gemini by reusing the dashboard session, the existing VaChat MCP route, or a raw service-role client.

**Production launch of merchant MCP is a NO-GO today.** The blockers are an OAuth 2.1 authorization server, organization-bound grants, audience-checked access tokens, a minimized tool DTO, durable rate limits, and an MCP server that follows Streamable HTTP. None of those exist for merchants.

**Beginning development is a GO**, if it stays read-only, ships as a sibling process in this repository, and does not book India Post shipments.

Recommended architecture: **Option C, narrowed.** A dedicated MCP gateway process in the same repository, importing existing modules, deployed on its own hostname. Do not split orders or shipments into new microservices. Do not put merchant MCP inside the current `/api/v1` cookie session.

| Gate | Answer |
| --- | --- |
| Architecture can host MCP without a rewrite | Yes, as an adapter |
| Existing business services reusable | Yes, behind a new auth context |
| Supabase login sufficient for third-party AI clients | No |
| Organization isolation safe for a new bearer path | Not until grants bind the organization |
| Dedicated business microservice required | No |
| Dedicated MCP process recommended | Yes |
| Safe V1 tools | Read-only orders, tracking cache, pending orders, analytics, existing NDR/RTO buckets |
| Platforms verified by a live connection test | None |
| Platforms supported by current official docs, with limits | Claude custom connectors; ChatGPT custom MCP (plan-gated); Gemini consumer custom apps (region and account limits); Gemini Enterprise custom MCP (separate product) |

---

## 2. Current Architecture Assessment

### Stack — VERIFIED

| Item | Evidence |
| --- | --- |
| Next.js 16.3.8, React 19.2.8, TypeScript 5, Zod 4 | `package.json` |
| App Router | `app/` routes, including `app/api/v1/[...slug]/route.ts`. No Pages Router `pages/` API tree was used for this product surface |
| Strict TypeScript, path alias `@/*` | `tsconfig.json` `strict: true`, `paths` |
| Request gate | `proxy.ts` `proxy()` (Next.js 16 proxy, not `middleware.ts`). Matcher covers almost all non-static paths and calls `updateSession` |
| Session | `@supabase/ssr` in `lib/supabase/server.ts` and `lib/supabase/proxy.ts` |
| Tenant | `requireTenant()` in `lib/api/context.ts` reads `profiles.active_organization_id`, then `organization_members` |
| RBAC | `lib/permissions/rbac.ts` roles OWNER, ADMIN, MANAGER, OPERATOR, VIEWER. Route map in `lib/api/v1-permissions.ts` |
| RLS | `public.is_org_member(org_id)` in `supabase/migrations/20260919090000_init_enums_identity.sql` lines 133–146. Tenant policies in `supabase/migrations/20260919090300_rls_storage_triggers.sql` lines 110–128. Membership check only; role is not in RLS |
| Service role | `createAdminClient()` in `lib/supabase/admin.ts` uses `SUPABASE_SERVICE_ROLE_KEY` and bypasses RLS |
| Jobs | Default `JOB_RUNNER=database`. `lib/jobs/drain.ts` claims `background_jobs`. Optional BullMQ via `workers/index.ts` and Redis |
| Rate limits | Dashboard/VaChat: in-memory `lib/security/rate-limit.ts`. Merchant API: Postgres `merchant_api_consume_rate` in `modules/merchant-api/rate-limit.ts` |
| Logs | JSON `lib/logger.ts` with key redaction. Sentry package `@sentry/nextjs` is a dependency. PostHog browser token is optional in `lib/env.ts` |
| Hosting | `Dockerfile` multi-stage Node 22, `output` standalone, `CMD ["node", "server.js"]`, Coolify volume comment for labels. `COOLIFY_*` env names in `lib/env.ts` |
| Public HTTP APIs | Session API `app/api/v1/[...slug]/route.ts` → `handleV1`. Merchant API `app/api/merchant/v1/[...slug]/route.ts` → `handleMerchantV1`. Admin, cron, Razorpay webhook, public tracking, storefront, OTP |

### Can MCP be a separate service without disrupting PostBus?

**Yes. PARTIALLY VERIFIED.** Business rules already live in `modules/*` and are called by HTTP handlers. A new process can import those functions if it builds a trusted `TenantContext` and passes a database client whose scope is explicit. It must not share the dashboard cookie, the VaChat platform key, or an unbounded service-role query.

The existing VaChat MCP is a different product. `handleV1` mounts `vachat/mcp` before `requireTenant` (`lib/api/v1/handle.ts` lines 48–50). `authorizeVachatMcp` compares a single platform API key (`modules/vachat/mcp.ts` lines 507–519). Remote tool calls without a server-injected support session return `MCP_UNAUTHORIZED` (`searchOrderDetails`, lines 375–383). Protocol constant is `2025-03-26`, CORS is `*`, and the implementation is a hand-rolled JSON-RPC subset, not the official SDK. **Do not extend this route into merchant AI Connect.**

---

## 3. Existing Service Reusability Matrix

MCP must call these functions. It must not copy their SQL. Handlers that require `NextRequest` should not be the tool boundary; the module functions should.

| Capability | Function | Path | Auth today | Org filter | External calls | Side effects | MCP reuse | Refactor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| List orders | `listOrders` | `modules/orders/service.ts` 135–175 | `TenantContext` from session | `.eq("organization_id", ctx.organizationId)` via `applyOrderListFilters` 103 | Shopify image enrich, fire-and-forget | May trigger image cache writes | High, after a read-only flag that skips image enrich | Add `includeImages: false` or a list DTO. Filters: status, source, payment, dates, `q`, page. Status enum is `ORDER_STATUSES` in `types/domain.ts` 69–79. There is no `PENDING` status |
| Order detail | `getOrder` | same file 177–191 | Tenant | org + id | same image enrich | same | High | Strip customer PII by default. Select includes customers, addresses, line items, shipments, invoices |
| Search | `q` ilike on `order_number`, `source_order_id` | `applyOrderListFilters` 112–114 | Tenant | yes | no | no | High | Do not search phone/email from the model unless a scope allows it |
| Pending | No single query named pending. Closest: status `IMPORTED`, `READY`, `PROCESSING`. WhatsApp queue is `listWhatsAppPendingOrders` via `GET orders/customer-links` (`lib/api/v1/commerce.ts` 154–160) | PARTIALLY VERIFIED | Tenant | yes | no | Define `get_pending_orders` as those three statuses, documented, not a new status | Mapping only |
| Bulk order ops | `bulkUpdateOrderStatus` | `modules/orders/bulk-status.ts` 13 | `shipments.write` | org | Can call `createShipmentsForOrders` with `action: "fulfill"` | Creates shipments / booking work | **Not V1** | None until write review |
| Create shipment | `createShipmentsForOrders` | `modules/shipments/service.ts` 77 | `shipments.write` | org on orders and existing shipments | Quota check, India Post booking jobs when enqueue is on | Duplicate guard: non-cancelled shipment per order 128–140; audit insert | **Not V1** | Keep idempotency inside this function |
| List / get shipment | `listShipments`, `getShipment` | same file 364–435 | Tenant | org + id | no on read | `getShipment` returns customer name/phone and tracking events | High for reads | Minimize customer fields |
| Tracking normalize | `mapIndiaPostEventToShipmentUpdate`, `planTrackingUpdate` | `modules/india-post/event-mapper.ts` | n/a (pure) | n/a | no | no | High | Operational statuses are the fixed enum in `types/domain.ts` 103–114 |
| Tracking sync | `enqueueDueTrackingSyncJobs`, `enqueueOrgTrackingSyncIfIdle` | `modules/india-post/tracking-sync.ts` | job runner | org jobs | India Post when the worker runs | Writes jobs; min interval default 900000 ms (`lib/env.ts` 44) | Read tools should **not** call this by default | Optional later tool |
| NDR live refresh | `syncNdrShipment`, `syncNdrVisibleShipments` | `modules/ndr-rto/service.ts`; route `POST ndr-rto/.../sync` | `shipments.write` | org | India Post bulk tracking | Mutates shipment state; visible sync max 20 (`modules/ndr-rto/schema.ts` 27) | Read tool uses `getNdrSummary` / `listNdrShipments` only | Do not expose sync in V1 |
| Tariff | `executeTariff`, `resolveTariffInput`, `loadTariffConnection` | `modules/india-post/tariff.ts`; route `lib/api/v1/tariff.ts` | `orders.read` or `orders.write`; feature flag `INDIA_POST_TARIFF_QUOTES_ENABLED` | org on connection and order | India Post tariff API | **Writes refreshed encrypted tokens** (tariff.ts 98–108). In-memory 90/min and 2 in flight per org (`tariff.ts` route 49) | Conditional | V1 should prefer refusing when the flag is off. If enabled, call the same function, never a second tariff client |
| Volumetric weight | `indiaPostVolumetricWeightGrams` | `modules/india-post/endpoints.ts` 275–277 `(L*W*H)/5` ceil | none | none | no | no | Use only inside tariff validation | `indiaPostChargeableWeightGrams` in `modules/india-post/weight.ts` |
| Article validation | `validateIndiaPostArticle` | `modules/india-post/article-validator.ts` | none | none | no | no | For future writes | Not a public tool |
| Labels | `officialIndiaPostLabelPdfResponse` and label routes in `lib/api/v1/commerce.ts` around 340 | session + org check | org | India Post / PDF render | File bytes, possible provider fetch | **Not V1** | PDF is a poor MCP payload and a provider side effect |
| Analytics | `getKpis`, `getPipeline` | `modules/dashboard/service.ts` | `orders.read` | org | no | no | High | Date window args already exist for KPIs |
| Analytics year | `getAnalytics` | `modules/dashboard/analytics.ts` 359–382 | Tenant | org | no | Reads up to `ANALYTICS_MAX_ROWS` 5000 per table, page 1000, IST year. Sets `truncated` | Medium | Add a bounded date-range query before exposing this to 10k merchants. Current function ignores arbitrary ranges |
| Merchant list/detail | `listMerchantOrders`, `getMerchantOrder` | `modules/merchant-api/orders.ts` | API key, service role | `ctx.organizationId` from key row | reuses `getOrder` | `last_used_at` update on the key | Pattern to copy, DTO too wide | `publicOrderDto` includes name, phone, email, full address, COD (`modules/merchant-api/dto.ts` 32–71) |
| Merchant tracking | `getMerchantTracking` | `modules/merchant-api/shipments.ts` | scope `tracking:read` | org | reads stored shipment | no live CEPT on this read path — PARTIALLY VERIFIED from DTO shape | Good read model | Still confirm no refresh inside `getMerchantTracking` before wiring (function starts line 120) |

**Authentication dependency for dashboard services:** a `TenantContext` (`userId`, `organizationId`, `role`, `permissions`). The functions do not read the organization from tool arguments. That property must be preserved.

**Error handling:** `AppError` codes in `lib/api/errors.ts`. Missing rows become `RESOURCE_NOT_FOUND` without saying whether the id exists in another organization. Keep that behavior.

---

## 4. MCP Architecture Comparison

| Criterion | A. Routes inside Next.js | B. Dedicated service calling HTTP APIs | C. Gateway process importing modules | D. Extend VaChat MCP |
| --- | --- | --- | --- | --- |
| Security | Weakest isolation. `proxy.ts` refreshes the user session on nearly every path. Cookie and MCP bearer would share a host unless carefully split | Strong network boundary, but the Merchant API is service-role and returns full PII. A second HTTP hop can drift from RBAC | Strong: own origin, no dashboard cookies, org from the grant, same SQL as the app | Unsafe. One platform key, service role, support-session trust model, CORS `*` |
| Maintainability | One deploy, MCP releases restart the storefront | Two protocol stacks to keep in sync | One repo, two processes, shared functions | Mixes WhatsApp support with merchant tools |
| Scalability | Competes with PDF, booking drain, and dashboard on the same Node process. In-memory rate limit is per process | Can scale separately; duplicates timeouts and error mapping | Scales separately; DB pool must be capped | Makes the main API the AI attack surface |
| Deploy complexity | Lowest | Highest if it cannot import `modules/` | Moderate: second Coolify app from the same image, different command | Lowest and wrong |
| Cost | Lowest | Extra always-on instance | One small always-on instance | Lowest |
| Latency | Lowest | Extra HTTP hop | Low, in-process calls | Low |
| Developer experience | Familiar Next route | Forces tools through a public contract that is not AI-shaped | Import `listOrders` directly; contract tests on the adapter | Looks done, is not |
| Reliability | MCP bug or slow tool can affect `www.postbus.in` | Failure stays in the gateway; can still overload Postgres and CEPT | Same DB risk, process crash stays off the web app | Direct blast radius on `/api/v1` |
| Tenant isolation | Easy to accidentally use `active_organization_id` | Safe only if the credential is org-bound. API keys are, user sessions are not | Enforced in the gateway before the module call | Support session, not merchant org |
| Fit with current services | Good | Poor. Merchant API has no analytics or NDR summary | Best | Poor |

**Option D is rejected.** Evidence: `modules/vachat/mcp.ts`.

**Option B is rejected as the primary design.** The Merchant API (`modules/merchant-api/handle.ts`) is a good external contract for developer integrations and a bad AI session model: long-lived hashed secrets, no user consent screen, no per-connection organization picker beyond the key’s org, and full customer DTOs.

**Option A is acceptable only as a temporary prototype** behind a path excluded from session refresh. It is not the production recommendation because label generation, tariff token refresh, and job drain already share this process (`Dockerfile` also copies `scripts/drain-jobs.mjs` for the same app).

---

## 5. Recommended Architecture

**Option C — MCP gateway in this repository, separate process and hostname, shared service layer.**

```
AI client
  → HTTPS mcp.postbus.in/mcp          (Streamable HTTP, stateless JSON)
  → bearer access token
  → gateway verifies signature, audience, expiry, revocation, scopes
  → loads mcp_connection (user_id, organization_id, scopes)
  → re-checks organization_members and role
  → builds TenantContext
  → calls modules/orders, modules/shipments, modules/dashboard, modules/ndr-rto
  → returns a minimized DTO
```

The organization id is loaded from the connection row. Tool arguments named `organization_id` are ignored, matching the intent already documented for VaChat tools (`IGNORED_IDENTITY` in `modules/vachat/mcp.ts` 133–137) but enforced for a real merchant grant.

Authorization UI stays on `www.postbus.in` (existing dashboard session):

1. Merchant starts connect from the AI client or from Settings → Integrations → AI Connect.
2. AI client runs OAuth 2.1 authorization code + PKCE against PostBus.
3. Merchant signs in with the existing Supabase session.
4. Merchant selects one organization (`listMemberships` / `switchOrganization` in `modules/organizations/service.ts` are the membership source of truth; the grant must store the chosen id, not `profiles.active_organization_id`).
5. Merchant sees scopes and approves.
6. Client receives an audience-bound access token and a rotating refresh token.
7. Every tool call repeats membership and scope checks.

**Supabase Auth is the user login. It is not the third-party authorization server.** `is_org_member` depends on `auth.uid()` (`init_enums_identity.sql` 140–144). A ChatGPT or Claude bearer token is not that JWT. The service role has no `auth.uid()` and bypasses RLS. An additional authorization layer is required.

SDK to implement against, verified 19 October 2026 from npm and the project docs, not from memory of an older package:

- Current server line: `@modelcontextprotocol/server` **2.3.1** (released 5 October 2026), spec line documented as 2026-07-28.
- Legacy `@modelcontextprotocol/sdk` **1.32.1** implements through spec 2025-11-25 and is maintenance-only.
- Transport: Streamable HTTP. Stateless handler via `createMcpHandler` with `responseMode: 'json'` unless a client requires SSE. Stateless mode avoids in-memory session affinity.
- PostBus Zod 4 is compatible with the v2 SDK examples that import `zod/v4`.
- Do not copy the VaChat hand-rolled server (`MCP_PROTOCOL_VERSION = "2025-03-26"`).

This audit did not install the SDK and did not run a client handshake.

---

## 6. ChatGPT Compatibility Findings

**Classification: SUPPORTED WITH LIMITATIONS.** No live PostBus handshake was performed.

| Question | Finding | Status |
| --- | --- | --- |
| Transport | SSE and streaming HTTP | VERIFIED — [Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), fetched 19 Oct 2026 |
| Remote server | Yes, public HTTPS URL in ChatGPT Plugins → Add custom MCP server | VERIFIED, same page |
| OAuth | OAuth, no auth, or mixed. OAuth expected to follow MCP authorization. Protected resource metadata and `WWW-Authenticate` described in [Authentication](https://developers.openai.com/plugins/build/auth) | VERIFIED |
| Client registration | Static client, Client ID Metadata Documents, or DCR when configured | VERIFIED, custom MCP server guide |
| Read tools | Supported. `search` / `fetch` are not required | VERIFIED |
| Write tools | Documented as available, subject to confirmation settings | VERIFIED as a client capability. PostBus must still not ship writes in V1 |
| Confirmation | User/workspace controls; prompting does not replace server-side confirmation | VERIFIED at the warning level |
| Plan | Help Center: full MCP including write actions is beta for ChatGPT **Business, Enterprise, and Edu**. Admins publish workspace apps. Updated text retrieved 19 Oct 2026 from [Creating custom MCP apps](https://help.openai.com/en/articles/12584461-creating-custom-mcp-apps-in-chatgpt) | VERIFIED for those plans |
| Consumer ChatGPT (Free/Plus/Pro) | Not established by the Help Center excerpt above | **REQUIRES VALIDATION** |
| OpenAI API | Responses API remote MCP tools accept Streamable HTTP or HTTP/SSE. This is developer API usage, not the ChatGPT UI. [MCP servers](https://developers.openai.com/api/docs/guides/tools-connectors-mcp) | VERIFIED as a separate surface |
| Region | Not stated in the pages fetched | UNVERIFIED |
| Setup | Merchant or workspace admin pastes `https://mcp.postbus.in/mcp`, completes OAuth, enables tools | Documented by OpenAI; not tested |

---

## 7. Claude Compatibility Findings

**Classification: SUPPORTED WITH LIMITATIONS.** No live handshake was performed.

| Question | Finding | Status |
| --- | --- | --- |
| Transport | Streamable HTTP recommended. Legacy HTTP+SSE still accepted and being deprecated | VERIFIED — [Build an MCP server for Claude](https://claude.com/docs/connectors/building), 19 Oct 2026 |
| Remote | Yes. Claude calls from Anthropic cloud, including Desktop and mobile, so the server must be public. [Get started with custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), updated over 2 weeks before 19 Oct 2026 | VERIFIED |
| Plans | Free, Pro, Max, Team, Enterprise. Free: one custom connector. Team/Enterprise: an Owner adds the connector first; each member authenticates | VERIFIED, same help article |
| OAuth | OAuth 2.0 with PKCE S256. DCR and CIMD by default. Redirect `https://claude.ai/api/mcp/auth_callback` plus loopback for Claude Code. Specs cited by Anthropic: 2025-03-26, 2025-06-18, 2025-11-25. First `authorization_servers` entry only. 401 required to start login. Discovery/token budget 10s; refresh 30s | VERIFIED — [Authentication for connectors](https://claude.com/docs/connectors/building/authentication) |
| `client_credentials` | Not supported for Claude’s client | VERIFIED |
| Read vs write | Tools start as “Not set”; Claude asks before use. Users can set Always allow. That client control is not PostBus authorization | VERIFIED — [Custom connectors](https://claude.com/docs/claude-science/custom-connectors) |
| Static API key header | Beta, limited orgs, shared by every member. Wrong model for per-merchant org binding | VERIFIED |
| Claude API (Messages API) | Not the same as claude.ai connectors. This audit did not verify MCP fields on the Messages API | UNVERIFIED for API product |
| Setup | Customize → Connectors → custom web connector → URL → OAuth | Documented, not tested |

PostBus should implement DCR and exact redirect allow-listing, advertise only the PostBus authorization server, and support the Claude callback URL. CIMD is optional if DCR works. Do not rely on a static header key.

---

## 8. Gemini Compatibility Findings

These are different products. Do not mark “Gemini” as one row.

| Surface | Transport | Remote custom server | OAuth | Classification | Evidence |
| --- | --- | --- | --- | --- | --- |
| Gemini consumer app, gemini.google.com and mobile | MCP URL; spec compliance required. SSE vs Streamable HTTP not spelled out in the help excerpt | Yes, Settings → Connected Apps → Custom apps. Add on web only | If the server lacks DCR, user can open Advanced and enter credentials | **SUPPORTED WITH LIMITATIONS** | [Connect & manage custom apps](https://support.google.com/gemini/answer/17209137), fetched 19 Oct 2026. Requirements in that page: age 18+, United States, personal Google Account, English, Keep Activity on. Work/school accounts excluded. Write actions require manual confirmation, and Google warns the model can still be wrong |
| Subscription tier for consumer custom apps | — | — | — | **PARTIALLY VERIFIED** | Official excerpt lists the constraints above and does not, in the captured text, name Google AI Pro/Ultra. Secondary write-ups do. Re-read the help page before any marketing claim |
| Gemini API (generativelanguage / AI Studio model API) | — | Not shown as “paste merchant MCP URL” | — | **NOT CURRENTLY SUPPORTED** as a merchant connect flow | No official page in this audit showed the Gemini API accepting an arbitrary PostBus MCP server the way ChatGPT’s Responses API does |
| Gemini Enterprise / Business edition | Streamable HTTP only. Legacy SSE not supported | Yes, admin-created custom MCP data store. Public IdP. Redirect documented as `https://vertexaisearch.cloud.google.com/oauth-redirect` on the enterprise setup page | OAuth against a public IdP | **SUPPORTED WITH LIMITATIONS** | [Custom MCP data store](https://docs.cloud.google.com/gemini/enterprise/docs/connectors/custom-mcp-server/set-up-custom-mcp-server), [Business edition help](https://support.google.com/g/answer/17106276) last updated 15 September 2026. Pre-GA. TLS must be publicly trusted. Action cap 100 |
| Gemini CLI / Antigravity / Cloud MCP clients | Streamable HTTP | Yes for configured remote servers, often Google credentials | Google OAuth / ADC, not automatically PostBus OAuth | **REQUIRES VALIDATION** for a merchant-facing flow | [Configure MCP](https://docs.cloud.google.com/mcp/configure-mcp-ai-application). Developer tools, not the PostBus merchant audience |

India-based PostBus merchants will often fail the consumer Gemini US and personal-account rules. Claude and, where the plan allows, ChatGPT are the realistic V1 clients. Gemini Enterprise is a separate later integration, not the same consent UX.

---

## 9. OAuth and Authentication Findings

### What exists — VERIFIED

- Supabase email/session cookies via `@supabase/ssr`. OTP WhatsApp auth exists under `lib/auth/otp/` and is a user login method, not an OAuth server.
- `GET me` returns the active workspace from `ensureActiveWorkspace` (`lib/api/v1/session.ts`).
- `switchOrganization` checks membership, then writes `active_organization_id` (`modules/organizations/service.ts` 97–114).
- RBAC is application-side (`hasPermission`).
- Shopify OAuth in `modules/shopify/oauth.ts` is PostBus-as-client to Shopify, with a state cookie. It is not an authorization server for AI clients.
- Merchant API keys: lookup id, HMAC hash, scopes, expiry, revoke (`modules/merchant-api/auth.ts`). Organization comes from `api_keys.organization_id`. This is a confidential credential, not user OAuth.
- No `oauth_clients`, authorization codes, MCP refresh tokens, or protected-resource metadata routes were found.

### What is required — NOT IMPLEMENTED

| Control | Requirement |
| --- | --- |
| OAuth 2.1 authorization code + PKCE S256 | Required by Claude and by the MCP authorization profile OpenAI points at |
| Discovery | `/.well-known/oauth-protected-resource` on the MCP origin and authorization-server metadata. `resource` must be the canonical MCP URL (`https://mcp.postbus.in/mcp`) |
| Redirect URIs | Exact match. Allow Claude’s callback. Allow OpenAI’s documented callbacks once copied from current OpenAI docs at build time. Allow Gemini’s enterprise redirect only if that product is in scope. Reject wildcards |
| Client registration | DCR (RFC 7591) for Claude’s default path. Optional CIMD. Pre-register known clients if DCR is restricted to an allowlist of redirect URIs |
| Tokens | Short-lived access token (15 minutes or less), audience = MCP resource, subject = user id, no organization id inside a client-mutable claim that the server does not also store. Refresh token rotation for public clients. Store only hashes |
| Scope | Separate from dashboard RBAC but mapped onto it: `orders:read`, `shipments:read`, `tracking:read`, `analytics:read`. Refuse `shipments:book` until a later review |
| Revocation | Immediate on connection delete, password/security events, member removal |
| Replay / CSRF | PKCE, state, one-time codes, nonce on the authorize request |
| Consent | Server-rendered page on `www.postbus.in` listing org name and scopes. Re-prompt on scope upgrade |
| Storage | Gateway verifies the token, then loads the server-side grant. Do not trust JWT `organization_id` alone |
| Membership changes | On each call, if the member row is gone or the role lost `orders.read`, deny |

**Supabase Auth alone is not sufficient.**

---

## 10. Multi-Tenant Security Assessment

### Current controls — VERIFIED

- Tables `organizations`, `organization_members` (`role`), `profiles.active_organization_id`.
- RLS: `is_org_member(organization_id)` on orders, shipments, tracking_events, labels, india_post_connections, shopify tables, api_keys, and the rest of the loop in `20260919090300_rls_storage_triggers.sql`.
- Dashboard queries add `.eq("organization_id", ctx.organizationId)` after the active org is resolved and membership is checked (`lib/api/context.ts` 39–58).
- `getOrder` / `getShipment` return not found when the id is outside the org, which avoids cross-tenant existence leaks at that layer.
- India Post passwords and tokens are encrypted at rest (`encryptSecret`, AES-256-GCM, `lib/security/crypto.ts`) on `india_post_connections`.
- Merchant keys are HMAC-hashed, not stored raw.

### Gaps for MCP — these are design gaps, not proof of a current merchant-MCP bug

| ID | Sev | Finding | Evidence | Impact | Recommendation |
| --- | --- | --- | --- | --- | --- |
| MCP-001 | P0 | No merchant OAuth grant. A future tool that accepts `organization_id` would be tenant spoofing | NOT IMPLEMENTED. VaChat explicitly ignores that argument only for its own tools | Cross-tenant read | Bind org on the connection row. Ignore model arguments |
| MCP-002 | P0 | Service role bypasses RLS. Merchant API and VaChat MCP already use it | `lib/supabase/admin.ts`; `handleMerchantV1`; `handleVachatMcpRequest` | Any missed `.eq("organization_id")` is a full-table read | After the grant check, either use a user-scoped client or a single query helper that requires org id. Add tests that omit the filter and expect failure |
| MCP-003 | P1 | Active organization is a profile preference, not a grant | `requireTenant` uses `active_organization_id`. `switchOrganization` changes it | A cookie-based MCP session would change tenant when the user switches workspace in another tab | Do not attach MCP to the dashboard session |
| MCP-004 | P1 | RLS is membership, not role | `is_org_member` has no role predicate | A VIEWER who passes RLS can still be stopped only by `hasPermission` | Gateway must call the same permission check as `requireTenant` |
| MCP-005 | P1 | Tariff path loads India Post secrets with the service role and writes new tokens | `lib/api/v1/tariff.ts` 56–63; `tariff.ts` 98–108 | A chatty rates tool refreshes carrier credentials and spends CEPT quota | Default the rates tool off unless the existing flag is on, and keep the per-org limiter |
| MCP-006 | P1 | In-memory rate limit does not survive multiple instances | `lib/security/rate-limit.ts` | Per-IP 60/min on VaChat is not a global cap | Use the merchant SQL bucket or a new one |
| MCP-007 | P2 | `publicOrderDto` is the wrong AI shape | `modules/merchant-api/dto.ts` | Phone, email, street address enter the model context | New `mcpOrderDto` |
| MCP-008 | P2 | VaChat CORS `*` and platform key | `mcpCorsHeaders` | Unrelated, but shows a permissive MCP habit | Merchant MCP origin allowlist; no shared key |

**Threat principle:** the model never selects the organization. If the user has several workspaces, the consent screen selects one and that choice is stored on `mcp_connections`. Tool execution loads it again and re-checks membership.

Cross-organization relationships (Shopify shop domain, India Post contract, tracking barcode) must be resolved with `organization_id` from the grant plus the object id. Barcode lookup without org is forbidden. `findShipmentByArticle` in `modules/india-post/webhook.ts` is a webhook path and must not be reused as an MCP lookup without an org predicate. This audit did not re-read every branch of that function; treat unscoped barcode search as unsafe until a test proves the predicate.

---

## 11. Proposed MCP Tool Specifications

Tools are proposed. They do not exist. V1 names should stay small so clients are not overloaded (Gemini Enterprise documents a 100-action cap; that is not the binding limit, clarity is).

### `list_orders` — safe for V1

- Call `listOrders` with status, from, to, q, page, pageSize (cap 50).
- Org from the grant. Permission `orders.read`.
- Return order number, status, payment status, source, totals, created time, shipment id and AWB if present.
- Omit street address, phone, and email unless a future `customers:read` scope exists. V1 should omit them.
- Pagination is offset today. Do not invent cursor behavior unless you switch to `listMerchantOrders`’s cursor. Document offset limits.

### `get_order_details` — safe for V1 with minimization

- Call `getOrder` only after org filter (already inside the function).
- Same field policy. Include shipment status and AWB.
- Unknown id: “Order not found.” Do not distinguish wrong org from missing id.

### `track_shipment` — safe for V1 against stored data

- Input: `shipment_id` or `tracking_number`, never either as an authorization key.
- Resolve with `.eq("organization_id", grant.organizationId)` then id or barcode.
- Return `publicTrackingDto`-shaped data: status, events, classification, PostBus tracking URL (`modules/merchant-api/dto.ts` 100–118).
- Do not call India Post on the tool path. Cache freshness is whatever tracking sync last wrote (`last_tracked_at` / `last_event_at`). Tell the model the data can be up to the sync interval old (default 15 minutes, `INDIA_POST_TRACKING_SYNC_MIN_INTERVAL_MS`).

### `get_shipping_rates` — defer or flag-gate

- Existing quote path is real CEPT and mutates tokens.
- Inputs: destination PIN, weight, dimensions, service. Source PIN comes from the org’s saved pickup/drop-off offices (`tariffSourcePincode`), not from the model, unless you explicitly allow an override later.
- Services already understood by tariff code include the app’s service codes; `BP` / `SP` aliases are normalized in `tariffOrderDefaults`.
- Accuracy is India Post’s response for that contract, not a PostBus price list. If `indiaPostTariffQuotesEnabled` is false, the tool must return a clear disabled error (`lib/api/v1/tariff.ts` 25–27).
- **Recommendation:** V1 ships the tool only when that flag is already on for production, with the existing org limiter. Otherwise omit the tool so clients do not discover a broken action.

### `get_shipping_analytics` — safe if bounded

- `getKpis(supabase, ctx, from, to)` and `getPipeline` accept a window (`lib/api/v1/commerce.ts` 123–130).
- `getAnalytics` does not. It scans the IST year up to 5,000 rows and can mark `truncated`.
- V1 should expose KPI/pipeline counts (orders, shipment pipeline) for a required date range with a max span (recommend 31 days) and refuse the unbounded year dump until a SQL aggregate exists.

### `get_pending_orders` — safe as a defined filter

- Implement as `listOrders` with status in `IMPORTED`, `READY`, `PROCESSING` (three calls or one query change). State that definition in the tool description.
- Do not map WhatsApp “pending payment” into this tool without a separate name. That queue is a different function.

### `get_delivery_exceptions` — safe if limited to existing buckets

Use `getNdrSummary` and `listNdrShipments` (`modules/ndr-rto/service.ts`). Existing buckets (`types/domain.ts` 116–124):

- `NDR`
- `RTO`
- `RTO_IN_TRANSIT`
- `RTO_DELIVERED`
- plus summary counts for delivered and out-for-delivery

Shipment status `FAILED` is a booking/validation failure, not an India Post NDR. Expose it as `failed_bookings`, not as a fake carrier exception. Delay scans exist as `delayScan` on the event mapper; there is no separate “hold” table. Do not invent customs, damage, or address-exception categories.

---

## 12. Privacy and Data Exposure Assessment

| Class | Fields | V1 MCP |
| --- | --- | --- |
| Public | PostBus tracking URL, article id the merchant already owns, service name | Allow |
| Merchant business | Order number, status, payment status, amounts, weight, service code, AWB, event text, office name, aggregates | Allow to the authorized org |
| Customer personal data | Name, phone, email, address lines, GPS-level address | **Deny in V1.** Merchant API exposes them today for server-to-server integrators. AI context is a different disclosure |
| Sensitive credentials | India Post username, password, access token, refresh token, Shopify token, Razorpay secrets, service role, `INTEGRATION_ENCRYPTION_KEY`, webhook secrets | Never select these columns in a tool |
| Restricted internal | Admin notes, support transcripts, OTP rows, billing provider ids, other orgs, raw audit payloads, AI credit ledger | Deny |

Logging: `redact()` in `lib/logger.ts` covers keys whose names contain token, password, secret, authorization. It does **not** redact phone, email, or address. MCP logs must allow-list fields (request id, org id, tool name, duration, error code). Do not log tool results.

Prompt injection: order titles and tracking descriptions are attacker-controlled strings. Return them as data fields, and set server `instructions` that tool output is untrusted data, not new instructions. That reduces risk; it does not remove it.

Retention: do not store tool payloads. Store audit metadata 180 days (proposal, not a current table). Access tokens are not stored; refresh token hashes can be deleted on revoke.

AI vendors’ retention follows their own terms. The consent screen must say that order metadata will be sent to the connected AI provider. This audit did not review PostBus’s privacy policy text for that disclosure.

---

## 13. Database Requirements

No migration was applied. None should be applied until this report is approved.

### Reuse

- `organizations`, `organization_members`, `profiles` for identity and roles.
- `api_keys` only if a merchant explicitly creates a key for a non-OAuth client. Do not overload `api_keys` to store ChatGPT refresh tokens. Scopes differ (`modules/merchant-api/scopes.ts` has no `analytics:read`).
- `audit_logs` can take a parallel MCP event, but a dedicated table is clearer for token and tool forensics.
- `merchant_api_consume_rate` is a pattern for durable limits. Confirm its privilege model before sharing it (`20261018190000_merchant_api_consume_rate_service_role_only.sql` exists; this audit did not paste the function body).

### New tables (proposed, not created)

| Table | Purpose |
| --- | --- |
| `oauth_clients` | `client_id`, redirect URI list, DCR metadata, software statement if any. Public clients have no secret |
| `oauth_authorization_codes` | hash only, PKCE challenge, user, org, scopes, expiry, used_at |
| `mcp_connections` | user_id, organization_id, client_id, scopes, status, created_at, revoked_at, last_used_at |
| `oauth_refresh_tokens` | connection_id, token_hash, rotated_from, expires_at, revoked_at |
| `mcp_audit_logs` | connection_id, tool, args hash, result class, error code, request id. No PII body |

Access tokens: JWT signed by a dedicated key, or opaque random values with a hash lookup. Prefer opaque high-entropy tokens plus a server row if immediate revocation matters more than stateless verification. If JWT, keep a `jti` denylist or a connection `tokens_valid_after` timestamp.

Encryption: hashes for tokens (SHA-256 or HMAC with a server pepper). Connection rows contain no India Post secrets. Encryption key stays `INTEGRATION_ENCRYPTION_KEY`; do not create a second ad hoc key in the database.

Indexes: `(organization_id, user_id)` on connections; unique hash on refresh tokens; `(connection_id, created_at desc)` on audit; partial index `status = 'active'`.

RLS: enable RLS, no policies for `anon` or `authenticated`. The gateway uses a narrow database role or the service role only inside the repository that has already checked the grant. Do not expose these tables to the browser Supabase client.

Revocation: set `revoked_at`. Delete or revoke descendant refresh tokens in the same transaction. Member removal job should revoke connections for that `(user_id, organization_id)`.

Retention: codes expire in minutes. Refresh tokens expire in 30 days of inactivity (proposal). Audit metadata 180 days.

Migration risk: low if tables are new and unused by the web app. High if someone alters `is_org_member` or `api_keys` in the same change. Do not.

---

## 14. Performance Assessment

Assumptions, stated so the numbers can be thrown out if they are wrong:

- 20 tool calls per connected merchant per day.
- 95% served from Postgres. Rates tool off, or under 1% of calls.
- No live India Post call on `track_shipment`.
- Page size ≤ 50. Analytics span ≤ 31 days using KPI queries, not `getAnalytics`’s 5,000-row scan.
- Sync interval remains 15 minutes via the existing worker, not via MCP.

| Merchants | Calls/day | Calls/min average | Notes |
| --- | --- | --- | --- |
| 10 | 200 | under 1 | Negligible next to dashboard traffic |
| 100 | 2,000 | about 2 | Fine on the current Postgres if queries stay indexed by `organization_id` |
| 1,000 | 20,000 | about 14 | Still small if tracking is cached. A burst at 10x is the risk, not the average |
| 10,000 | 200,000 | about 140 average, bursts higher | Needs the separate process, SQL rate limits, connection pool cap, and analytics that do not pull 5,000 rows per call |

**Safe default:** MCP reads PostBus tables. India Post is called by the existing tracking jobs and, only when the flag is on, by the existing tariff function. A chat session must not poll CEPT.

Effects to avoid:

- Dashboard: separate process so MCP latency does not sit in the Next.js event loop. Shared database still matters.
- India Post quota: a `track_shipment` that refreshed live would multiply the 15-minute sync. Do not.
- Shopify sync and booking jobs: do not enqueue from read tools.
- `getAnalytics` at 10,000 merchants would be a production incident. Do not bind that function to the tool unchanged.

Pool sizes and Supabase plan limits were not read from the hosted project. **UNVERIFIED** against production metrics. Before 1,000 merchants, measure p95 of `listOrders` and connection count.

---

## 15. Existing System Regression Risks

| Area | Shared dependency | If MCP is inside the Next process | If MCP is a sibling process |
| --- | --- | --- | --- |
| Shopify sync | `background_jobs`, service role | Event-loop stalls delay drain | DB hot queries can still slow sync |
| India Post booking | booking jobs, connection row locks | Tariff token writes can collide with booking session locks. `tariff.ts` already avoids the booking lock on purpose (comment at line 83) | Same DB contention if rates are enabled |
| Labels | CPU and `/data/labels` | PDF work competes | Isolated if tools do not render PDFs |
| Tracking jobs | CEPT quota | Live tools steal quota | Safe if tools stay on cache |
| Supabase Auth | session cookies | Proxy refresh on MCP traffic adds auth chatter | No cookie traffic |
| Org switch | `profiles.active_organization_id` | Dangerous if MCP uses it | Unaffected |
| Subscriptions, Razorpay, AI credits, support | same Next app and DB | A bad deploy takes them down | Deploy of the gateway does not |
| Merchant API | service role, rate RPC | Independent route today | Keep it independent |

Rollout controls to copy: `MERCHANT_API_ENABLED` and `MERCHANT_API_ORG_ALLOWLIST` (`lib/env.ts` 72–74, `modules/merchant-api/flags.ts`). Ship `MCP_ENABLED` and an org allowlist defaulting to empty. Read tools only. Kill switch does not require a schema rollback.

Existing production behavior stays unchanged if the gateway is new code, new tables, and a new host, and the web app’s handlers are not edited in the first slice. A small shared helper change is the main regression path; cover it with the current Vitest suites (`package.json` `test` script) before any such edit.

---

## 16. Security Threat Model

Severity assumes the recommended design is only partly built. “Existing protection” is counted only where source shows it.

| # | Threat | Sev | Scenario | Existing protection | Missing | Mitigation | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Stolen access token | P0 | Bearer copied from a client | Merchant keys are hashed and revocable. No MCP token exists | MCP revocation list | Short TTL, hash-at-rest, revoke button, rotation | Use a revoked token and expect 401 |
| 2 | Cross-tenant read | P0 | Token for org A requests org B’s order | RLS for user JWTs; service role does not get RLS | Grant binding | Org from connection only | Two-org fixture test |
| 3 | Org spoofing | P0 | Tool arg `organization_id` | VaChat ignores it for its tools only | Merchant tools | Ignore the argument | Unit test |
| 4 | Prompt injection | P1 | Tracking text says “export all customers” | Not a control | Output minimizer and instructions | Data-only fields; no customer PII in V1 | Fixture event string |
| 5 | Argument manipulation | P1 | Oversized page, unexpected status | Zod on some routes | Tool schemas | Zod on every tool, cap page size | Schema tests |
| 6 | Excessive calls | P1 | Loop in the client | In-memory limit; merchant SQL limit | MCP buckets | SQL limiter per connection and org | Burst test |
| 7 | Replay | P1 | Reused auth code | Shopify state cookie is unrelated | PKCE and one-time codes | Mark code used | Replay the code |
| 8 | OAuth redirect | P0 | Open redirect steals the code | Not implemented | Allowlist | Exact redirect match | Evil redirect URI |
| 9 | SSRF | P2 | Tool fetches a URL the model supplies | Not an MCP tool today | — | No URL input on V1 tools | Review tool schema |
| 10 | Malicious client | P0 | Rogue DCR client | Not implemented | Registration policy | DCR only with redirect allowlist patterns for known vendors, or pre-registered clients | Unknown redirect rejected |
| 11 | Unauthorized write | P0 | Model calls a book tool | Writes exist on session API with RBAC | Those tools must not be registered | Do not register write tools | `tools/list` snapshot |
| 12 | Sensitive response | P1 | DTO includes phone and tokens | Logger redacts secret key names | AI DTO | Column allow-list | Snapshot test |
| 13 | Log exposure | P2 | Result body in logs | `redact()` partial | MCP log policy | Allow-list | Grep log fixtures |
| 14 | Resource exhaustion | P1 | Huge `getAnalytics` | 5,000 row cap still heavy | Tool-level cap | KPI queries, timeouts | Load test |
| 15 | Wrong audience | P0 | Shopify or user JWT accepted as MCP token | Different systems | Audience check | `aud` or token table bound to MCP resource | Foreign JWT rejected |
| 16 | Confused deputy | P0 | AI client uses the user’s session to act in the org the user last opened | `active_organization_id` | Separate grant | Consent names the org | Switch org in the app; MCP org unchanged |
| 17 | Revoked member | P1 | Removed user keeps a refresh token | Membership checked for dashboard | Connection re-check | Check members every call; revoke on delete | Remove member, call tool |
| 18 | Stolen client credentials | P1 | Confidential client secret leaked | Public PKCE clients should not have secrets | — | Public client + PKCE; no secret in the AI app | Review client type |
| 19 | Membership role drop | P1 | ADMIN becomes VIEWER, token still books | RBAC on session routes | Scope vs role | Re-read role each call | Demote and retry |
| 20 | Long request | P2 | Client holds a stream | Stateless JSON mode available in SDK docs | Timeouts | 10s tool budget, no SSE for V1 reads | Slow query aborted |

---

## 17. Implementation Dependencies

- Approval of this report and of Option C.
- DNS `mcp.postbus.in` and a public certificate. Not created by this audit.
- OAuth signing pepper or HMAC pepper in the existing secret store. New env names only, not edits during the audit.
- Decision on DCR allowlist versus open DCR.
- Legal line on the consent screen (customer data stays out of V1, merchant data does not).
- Confirmation that production `INDIA_POST_TARIFF_QUOTES_ENABLED` is intentional before exposing rates. The code defaults the flag to false (`lib/env.ts` 39).
- Official redirect URI list copied again at implementation time. Vendor docs move.
- No India Post production booking in test. Use current Vitest and the CEPT stub patterns under `modules/india-post/cept-local-stub.ts`. This audit did not run them.

---

## 18. Recommended Development Phases

Estimates are engineer-days for one engineer who already knows this repository. They are not calendar dates. They include tests and exclude store-listing review by OpenAI, Anthropic, or Google.

### Phase 1 — Read-only MVP — 40 to 55 engineer-days

- OAuth authorization code, PKCE, discovery, consent, org picker, hashed refresh tokens, revoke: 15–20
- Stateless Streamable HTTP gateway, official SDK, six read tools, minimized DTO, SQL rate limit, audit log: 12–16
- Dashboard AI Connect page (connect status, scopes, last used, revoke) under Integrations: 6–8
- Security tests and allowlist deploy: 7–11

Tools: `list_orders`, `get_order_details`, `track_shipment` (cache), `get_pending_orders`, `get_shipping_analytics` (KPI window), `get_delivery_exceptions` (existing buckets). Rates only if the flag is on.

### Phase 2 — Reporting — 8 to 12 engineer-days

- SQL aggregates that replace the 5,000-row analytics scan for arbitrary ranges.
- Exception report limited to NDR, RTO, RTO_IN_TRANSIT, RTO_DELIVERED, FAILED bookings, delay scans already computed.
- No new carrier categories.

### Phase 3 — Controlled writes — 25 to 40 engineer-days after a separate security review

Not part of the first release. See section 8 of the request, summarized below.

| Future tool | Risk | V1 | Later condition |
| --- | --- | --- | --- |
| `refresh_tracking_status` | Medium. Spends CEPT quota, writes events | No | Enqueue existing sync only, per-org cap, user confirm, idempotent if a job is already queued (`enqueueOrgTrackingSyncIfIdle`) |
| `create_shipment` / `book_india_post_shipment` | Critical. Real acceptance at India Post, money, barcodes | No | Server-side confirmation record of the exact payload, idempotency key, existing duplicate shipment guard, human confirm outside the model, reconcile via current booking states including `RECOVERY_REQUIRED` |
| `generate_shipping_label` | High. Provider fetch and PII on the label | No | Download in the dashboard, not a model attachment, after booking already exists |
| `bulk_book_shipments` | Critical. Partial failure already exists in bulk booking | No | Do not expose. Bulk paths are the highest reconciliation burden (`modules/india-post/bulk-worker.ts`) |
| `cancel_pending_order` | High. Status machine and possible carrier void, which this audit did not find as a clean void API | No | Only if a current cancel function is limited to unbooked orders |
| `retry_failed_booking` | Critical. Can double-book if recovery state is wrong | No | Only through `retryShipment` after the existing recovery rules, with confirm |

The model must not be the confirmation layer. A write, if it ever exists, needs a PostBus confirmation id created by a read of the validated payload, shown to the user on a PostBus or client confirmation card, and consumed once. Client-side “the assistant asked the user” is not that control. Claude and Gemini both document that users can loosen confirmations.

---

## 19. Testing Strategy

No tests were run for this audit.

**Unit:** Zod input and output for each tool; org argument ignored; not-found vs forbidden; pending status set; exception buckets only from `NDR_BUCKETS` plus `FAILED`; tariff disabled when the flag is off.

**Integration:** Call `listOrders`, `getOrder`, `getShipment`, `getKpis`, `getNdrSummary` through the gateway with a fixture user in two orgs. Assert the second org’s ids fail. OAuth code exchange with PKCE. Redirect mismatch fails.

**Security:** Expired token, revoked connection, audience mismatch, removed member, demoted role, replayed code, refresh rotation reuse, service-role test that a missing org filter cannot ship (query helper throws). Prompt-injection strings remain inside JSON strings.

**Load:** 50 concurrent `list_orders` for one org; analytics bounded; tariff mock when the flag is tested; India Post client stubbed. Do not book.

**Compatibility:** Manual, after a staging host exists: Claude Pro or Team custom connector, ChatGPT on a plan the Help Center allows, Gemini consumer only from a US personal account if still eligible, and one generic MCP inspector against Streamable HTTP. Record pass/fail. This audit’s matrix is documentation-only.

**Production safety:** staging Supabase and CEPT stub or UAT. `POSTBUS_ENV=staging` already refuses live CEPT URL fallback (`lib/env.ts` 86–94).

---

## 20. Deployment Requirements

Minimum:

- Hostname `mcp.postbus.in`, DNS A/AAAA or CNAME to the gateway, TLS from a public CA (required for Gemini Enterprise and expected by every remote client).
- Public ingress. Claude states it connects from Anthropic’s cloud, not the user’s laptop. Private VPC-only will fail for Claude and for consumer apps.
- Long-running Node. The app is already Node (`Dockerfile`), not a split serverless function. Stateless JSON responses avoid sticky sessions. Serverless is a poor fit if any client upgrades to SSE.
- Body limit 256 KB, same order of magnitude as `MERCHANT_PAYLOAD_LIMITS.defaultBytes`.
- Request timeout 10 seconds for reads, aligned with Claude’s discovery budget; tool work should finish inside that.
- Origin checks on the browser consent pages. MCP POST from servers is authorized by the bearer token, not by browser CORS. Do not copy VaChat’s `Access-Control-Allow-Origin: *` onto a credentialed browser flow.
- Separate Coolify application, same repo, command that starts only the gateway. Empty org allowlist. `MCP_ENABLED=false` default until the first pilot org.
- Logs and Sentry DSN for the new process, with the allow-list logger.
- No change to the web container’s start command in the first release.

Database connection budget: set the gateway pool small (start at 5) so it cannot starve the web app and the job drain. Exact Supabase limit: **UNVERIFIED**.

---

## 21. Estimated Engineering Effort

| Slice | Engineer-days |
| --- | --- |
| Phase 1 read-only production pilot | 40–55 |
| Phase 2 aggregates and reports | 8–12 |
| Phase 3 writes, after a new review | 25–40 |
| Live compatibility matrix on staging | 3–5, depends on vendor accounts |

Assumption: one senior engineer, no directory listing, no mobile app, consent UI in the current dashboard shell (`lib/dashboard/nav.ts` already has Integrations and Settings). Add about 30% if OAuth DCR interoperability takes a second client round.

---

## 22. Open Questions

1. Is ChatGPT Free/Plus/Pro allowed to add a custom MCP server, or only Business, Enterprise, and Edu? Help Center text supports the latter for full MCP. Confirm in the product UI before promising it.
2. Does consumer Gemini still require a US personal account on the day of launch? The help page said yes on 19 October 2026.
3. Which OpenAI redirect URIs are current at implementation time?
4. Should one user connect the same AI client to two PostBus orgs as two connections? Recommended yes.
5. Is production tariff quoting enabled? Code default is off. Do not turn it on for MCP.
6. What is the production Supabase pool limit and current p95 of order list?
7. Does the privacy policy already disclose third-party AI processors?
8. Are merchant API keys an acceptable fallback for developers who cannot complete OAuth, or is OAuth the only AI path? Recommended: OAuth only for AI Connect.

---

## 23. Release Blockers

| ID | Sev | Blocker | Status |
| --- | --- | --- | --- |
| MCP-001 | P0 | Organization bound to the token, not the model | NOT IMPLEMENTED |
| MCP-009 | P0 | OAuth 2.1 code + PKCE + exact redirects + resource audience | NOT IMPLEMENTED |
| MCP-010 | P0 | No write tools registered | NOT IMPLEMENTED (nothing is registered; keep it that way) |
| MCP-011 | P0 | Refresh-token hashing, rotation, revoke | NOT IMPLEMENTED |
| MCP-012 | P1 | Durable rate limit | NOT IMPLEMENTED for MCP. Pattern exists on Merchant API |
| MCP-007 | P1 | Minimized DTO | NOT IMPLEMENTED |
| MCP-013 | P1 | Membership re-check per call | NOT IMPLEMENTED for this channel |
| MCP-014 | P1 | Public TLS hostname | NOT IMPLEMENTED. Proposed only |
| MCP-015 | P1 | Cross-tenant tests | NOT IMPLEMENTED |
| MCP-016 | P1 | Empty allowlist and kill switch | NOT IMPLEMENTED. Copy merchant API flags |
| MCP-017 | P2 | Replace year-scan analytics before wide rollout | Existing function is the wrong default |
| MCP-005 | P1 | Rates tool calls CEPT and writes tokens | Gate on existing flag |

P3: dashboard polish, CIMD in addition to DCR, Gemini Enterprise redirect, directory listings.

---

## 24. Go / No-Go Recommendation

**NO-GO for production launch of POSTBUS AI CONNECT.**

**GO to start Phase 1 development** after this report is accepted, under these rules: read-only tools, new gateway process, new tables only, org allowlist empty by default, no India Post booking, no change to Shopify fulfillment, payments, or the current VaChat support MCP.

### Final gate

1. **Is the architecture ready for MCP?** The monolith can host an adapter. It is not ready to serve merchants until the blockers above exist.
2. **Can existing APIs be reused safely?** The module functions can. The HTTP session API and the VaChat MCP route should not be the merchant AI surface. The Merchant API can inform the DTO and rate-limit design but returns too much PII and uses long-lived keys.
3. **Is authentication sufficient?** No. Supabase login is necessary and not an OAuth authorization server for ChatGPT, Claude, or Gemini.
4. **Is organization isolation secure?** It is sound for the dashboard JWT plus RLS plus `requireTenant`. It is not automatically true for a new bearer token. Service role makes the application filter the only control.
5. **Is a dedicated MCP service necessary?** A separate business microservice is not. A separate gateway process on `mcp.postbus.in` that imports the current modules is the recommendation.
6. **Which tools are safe for V1?** `list_orders`, `get_order_details`, `track_shipment` from stored events, `get_pending_orders`, bounded `get_shipping_analytics`, `get_delivery_exceptions` using existing NDR/RTO/FAILED meanings. Rates only behind the current flag. No booking, labels, or cancel.
7. **Infrastructure?** Public DNS, trusted TLS, long-running Node, small DB pool, SQL rate limits, kill switch. Not serverless-first.
8. **Database changes?** New OAuth, connection, refresh-hash, and audit tables. Do not clone orders or shipments. Do not store raw tokens.
9. **Critical risks?** Stolen tokens, cross-tenant service-role reads, organization spoofing, OAuth redirect theft, wrong token audience, confused deputy via `active_organization_id`, and any write tool that books India Post.
10. **Which AI platforms are verified compatible?** None by a PostBus connection test. By vendor documentation on 19 October 2026: Claude custom remote connectors are supported with plan and network limits; ChatGPT custom MCP is supported with plan limits and an unresolved consumer-tier question; Gemini consumer custom apps are supported only inside Google’s stated US/personal/English/activity limits; Gemini Enterprise is a separate supported-with-limits path; the Gemini model API was not shown to accept this server.
11. **Before release?** Items MCP-001, MCP-009, MCP-010, MCP-011, MCP-012, MCP-007, MCP-013, MCP-014, MCP-015, MCP-016.
12. **Order?** OAuth and consent, then gateway and read tools, then security tests, then one allowlisted org on Claude, then ChatGPT on a confirmed plan, then Gemini only where eligibility is real.
13. **Effort?** 40–55 engineer-days for the read-only pilot.
14. **Rollout?** Second Coolify service, flag off, allowlist empty, one pilot organization, cache-only tracking, revoke tested, then widen the allowlist. The main web deploy stays on its current release until a shared-module change is required.
15. **Ready to begin MCP development?** Yes. **Ready to turn it on for merchants?** No.

---

## Evidence index

| Claim | Location |
| --- | --- |
| Next 16.3.8, workers, Vitest | `package.json` |
| Proxy and session | `proxy.ts`, `lib/supabase/proxy.ts`, `lib/supabase/server.ts` |
| Tenant and RBAC | `lib/api/context.ts`, `lib/permissions/rbac.ts`, `lib/api/v1-permissions.ts` |
| RLS | `supabase/migrations/20260919090000_init_enums_identity.sql`, `supabase/migrations/20260919090300_rls_storage_triggers.sql` |
| Orders, shipments, bulk | `modules/orders/service.ts`, `modules/orders/bulk-status.ts`, `modules/shipments/service.ts` |
| Commerce routes | `lib/api/v1/commerce.ts` |
| Tracking map and sync | `modules/india-post/event-mapper.ts`, `modules/india-post/tracking-sync.ts` |
| Tariff side effect | `modules/india-post/tariff.ts`, `lib/api/v1/tariff.ts` |
| NDR | `modules/ndr-rto/service.ts`, `types/domain.ts` |
| Analytics cap | `modules/dashboard/analytics.ts` lines 12–14 and 359–382 |
| Merchant API | `modules/merchant-api/handle.ts`, `auth.ts`, `dto.ts`, `scopes.ts`, `rate-limit.ts` |
| VaChat MCP | `modules/vachat/mcp.ts`, `modules/vachat/mcp-http.ts` |
| Org switch | `modules/organizations/service.ts` `switchOrganization` |
| Encryption and logs | `lib/security/crypto.ts`, `lib/logger.ts` |
| Host | `Dockerfile`, `lib/env.ts` |
| In-memory limit | `lib/security/rate-limit.ts` |
| Vendor docs | URLs in sections 6–8, fetched 19 October 2026 |

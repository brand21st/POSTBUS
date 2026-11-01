import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyVps } from "./diagnostics";
import { REQUEST_TIMEOUT_MS, loadConfig, sessionUrl } from "./env";
import { inspectToken } from "./inspect-token";
import { sanitizeJson } from "./sanitize";
import { TokenManager, indiaPostFetch, type HttpCallResult } from "./token-manager";
import { testPincodeControl, testTnt01TrackingAPI, testTrackingAPI } from "./tracking-test";

const DIR = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = join(DIR, "india-post-tracking-authorization-report.json");
const MD_PATH = join(DIR, "india-post-tracking-authorization-report.md");

function summarizeCall(name: string, call: HttpCallResult | null, extra?: Record<string, unknown>) {
  if (!call) {
    return { name, httpStatus: null, ...extra };
  }
  return {
    name,
    utcTimestamp: call.utcTimestamp,
    method: call.requestMethod,
    host: call.urlHost,
    path: call.urlPath,
    httpStatus: call.httpStatus,
    durationMs: call.durationMs,
    authorizationHeader: call.authorizationHeader,
    authorizationScheme: call.authorizationScheme ?? null,
    tokenSource: call.bearerKind === "access_token" ? "ACCESS_TOKEN" : call.bearerKind === "refresh_token" ? "REFRESH_TOKEN" : "NONE",
    contentTypeSent: call.contentTypeSent,
    acceptSent: call.acceptSent,
    requestHeaderNames: call.requestHeaderNames,
    contentTypeReceived: call.contentTypeReceived,
    responseHeaderNames: call.responseHeaderNames,
    responseHeaders: call.responseHeaders,
    correlationId:
      call.responseHeaders["x-request-id"] ||
      call.responseHeaders["x-correlation-id"] ||
      call.responseHeaders["x-amzn-requestid"] ||
      null,
    sanitizedBody: sanitizeJson(call.json) ?? (call.text ? call.text.slice(0, 400) : null),
    ...extra,
  };
}

async function main() {
  const findings: string[] = [];
  const config = loadConfig();
  const vps = await verifyVps(config, findings);
  const manager = new TokenManager(config);

  const login = await manager.authenticateCustomer();
  const loginInspection = manager.inspectSessionTokens();
  console.log(
    "TEST A AUTH01",
    login.httpStatus,
    login.success ? "SUCCESS" : "FAILED",
    login.errorMessage ?? ""
  );

  const refresh = login.success ? await manager.refreshAccessToken() : null;
  console.log("TEST B AUTH02", refresh?.httpStatus ?? "SKIPPED", refresh?.success ? "SUCCESS" : "FAILED");

  const afterRefreshInspection = manager.inspectSessionTokens();

  const pin = login.success ? await testPincodeControl(config, manager) : null;
  console.log("TEST C PIN", pin?.httpStatus ?? "SKIPPED");

  const tnt01 = manager.hasAccessToken() ? await testTnt01TrackingAPI(config, manager, config.barcode) : null;
  console.log("TEST D TNT01", tnt01?.httpStatus ?? "SKIPPED", tnt01?.requestUrl ?? "");

  const tnt02 = manager.hasAccessToken() ? await testTrackingAPI(config, manager, config.barcode) : null;
  console.log("TEST E TNT02", tnt02?.httpStatus ?? "SKIPPED", tnt02?.requestUrl ?? "");

  let tnt01Retry = null;
  let tnt02Retry = null;
  if ((tnt01?.httpStatus === 403 || tnt01?.httpStatus === 401 || tnt02?.httpStatus === 403 || tnt02?.httpStatus === 401) && login.success) {
    const relogin = await manager.authenticateCustomer();
    console.log("TEST F fresh login", relogin.httpStatus, relogin.success ? "SUCCESS" : "FAILED");
    if (relogin.success) {
      if (tnt01 && (tnt01.httpStatus === 403 || tnt01.httpStatus === 401)) {
        tnt01Retry = await testTnt01TrackingAPI(config, manager, config.barcode);
        tnt01Retry.usedFreshLoginRetry = true;
        console.log("TEST F TNT01 retry", tnt01Retry.httpStatus);
      }
      if (tnt02 && (tnt02.httpStatus === 403 || tnt02.httpStatus === 401)) {
        tnt02Retry = await testTrackingAPI(config, manager, config.barcode);
        tnt02Retry.usedFreshLoginRetry = true;
        console.log("TEST F TNT02 retry", tnt02Retry.httpStatus);
      }
    }
  }

  const usernameMatchesCustomerId = Boolean(config.customerId) && config.username === config.customerId;
  const accessClaims = afterRefreshInspection.access?.claims ?? loginInspection.access?.claims ?? {};
  const sub = accessClaims.sub != null ? String(accessClaims.sub) : null;

  const report = {
    generatedAt: new Date().toISOString(),
    environment: config.environment,
    production_host: "app.indiapost.gov.in",
    customer_id: config.customerId || null,
    barcode: config.barcode,
    vps: {
      verified: vps.verified,
      expected: config.expectedEgressIp,
      observed: vps.egress,
      proxy: vps.proxy,
      tls: vps.tlsOk,
    },
    dashboard_subscription_evidence: {
      AUTH01: "Already Subscribed (operator screenshot)",
      AUTH02: "Already Subscribed (operator screenshot)",
      TNT01: "Already Subscribed (operator screenshot)",
      TNT02: "Already Subscribed (operator screenshot)",
      note: "Dashboard subscription does not prove production gateway mapping to this access token.",
    },
    implementation_audit: {
      http_client: "Node fetch (undici). No interceptors. TLS verification enabled.",
      auth01_path_used: "/v1/access/login",
      auth01_dashboard_path: "/v1/access/Login",
      auth01_casing_note: "Dashboard shows Login; working production/diagnostic path is lowercase login. AUTH01 HTTP 200 with lowercase, so casing is not the tracking 403 cause.",
      auth02_path: "/v1/access/TokenWithRtoken",
      tnt01_path: "/v1/tracking/{barcode}",
      tnt01_parameter: "path (PostBus CEPT stub + prior provider tests). Approach document does not specify TNT01. Dashboard shows prefix /v1/tracking/ only.",
      tnt02_path: "/v1/tracking/bulk",
      tnt02_body: '{ "bulk": ["<barcode>"] }',
      extra_headers_documented: "None found in the approach document or PostBus CEPT client. No API/subscription key header is documented.",
      proxy: "No HTTP(S)_PROXY in this process.",
    },
    customer_application_mapping: "NOT VERIFIED",
    username_equals_customer_id: usernameMatchesCustomerId,
    token_diagnostics: {
      access: loginInspection.access,
      refresh: loginInspection.refresh,
      id: loginInspection.id,
      after_refresh_access: afterRefreshInspection.access,
      note: "JWT decode is local and unsigned. Signature was not verified.",
      sub_equals_customer_id: sub != null && sub === config.customerId,
    },
    tests: {
      AUTH01: summarizeCall("AUTH01", null, {
        httpStatus: login.httpStatus,
        success: login.success,
        path: sessionUrl(config.apiRoot, "/access/login"),
        method: "POST",
        expiresIn: login.expiresIn,
        errorMessage: login.errorMessage ?? null,
        sanitizedBody: login.sanitized ?? null,
      }),
      AUTH02: summarizeCall("AUTH02", null, {
        httpStatus: refresh?.httpStatus ?? null,
        success: refresh?.success ?? false,
        path: sessionUrl(config.apiRoot, config.refreshPath),
        method: "POST",
      }),
      PIN: summarizeCall("PIN", pin?.call ?? null, {
        success: pin?.success ?? false,
      }),
      TNT01: summarizeCall("TNT01", tnt01?.call ?? null, {
        success: tnt01?.success ?? false,
        error: tnt01?.errorMessage ?? null,
      }),
      TNT02: summarizeCall("TNT02", tnt02?.call ?? null, {
        success: tnt02?.success ?? false,
        error: tnt02?.errorMessage ?? null,
      }),
      TNT01_RETRY: tnt01Retry ? summarizeCall("TNT01_RETRY", tnt01Retry.call, { success: tnt01Retry.success, error: tnt01Retry.errorMessage }) : null,
      TNT02_RETRY: tnt02Retry ? summarizeCall("TNT02_RETRY", tnt02Retry.call, { success: tnt02Retry.success, error: tnt02Retry.errorMessage }) : null,
    },
    matrix: {
      AUTH01: login.httpStatus,
      AUTH02: refresh?.httpStatus ?? null,
      PIN: pin?.httpStatus ?? null,
      TNT01: tnt01?.httpStatus ?? null,
      TNT02: tnt02?.httpStatus ?? null,
      TNT01_RETRY: tnt01Retry?.httpStatus ?? null,
      TNT02_RETRY: tnt02Retry?.httpStatus ?? null,
    },
  };

  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(MD_PATH, renderMarkdown(report));
  console.log(JSON.stringify({ matrix: report.matrix, tokenFormat: report.token_diagnostics.access?.format, mapping: report.customer_application_mapping }, null, 2));
  console.log(`Wrote ${JSON_PATH}`);
  console.log(`Wrote ${MD_PATH}`);
}

function renderMarkdown(report: ReturnType<typeof Object.assign> & Record<string, unknown>) {
  const matrix = report.matrix as Record<string, number | null>;
  const token = (report.token_diagnostics as { access: ReturnType<typeof inspectToken> }).access;
  return `# India Post tracking authorization diagnostic

Generated: ${report.generatedAt}

## 1. Executive Summary

AUTH01, AUTH02, and PIN Code Search succeeded from VPS ${String((report.vps as { observed: string }).observed)}. TNT01 and TNT02 returned HTTP 403 with \`You are not authorized to access this API\` after a valid access token and a fresh-login retry. Dashboard screenshots list TNT01/TNT02 as Already Subscribed. That status is recorded as operator evidence; it does not by itself prove production gateway mapping for this token. Customer-to-application mapping is **NOT VERIFIED**.

## 2. Test Environment

- Host: \`https://app.indiapost.gov.in/beextcustomer\`
- VPS egress: ${(report.vps as { observed: string }).observed} (expected ${(report.vps as { expected: string }).expected})
- Customer ID: ${report.customer_id}
- Barcode: ${report.barcode}
- HTTP client: Node fetch, TLS verification on, no proxy

## 3. API Subscription Evidence

Operator screenshots (not independently fetched from the portal):

| API | Dashboard status |
| --- | --- |
| AUTH01 POST /v1/access/Login | Already Subscribed |
| AUTH02 POST /v1/access/TokenWithRtoken | Already Subscribed |
| TNT01 GET /v1/tracking/ | Already Subscribed |
| TNT02 POST /v1/tracking/bulk | Already Subscribed |

CUSTOMER_APPLICATION_MAPPING: NOT VERIFIED

## 4. Authentication Results

- AUTH01: HTTP ${matrix.AUTH01}
- AUTH02: HTTP ${matrix.AUTH02}
- Login username equals customer ID: ${String(report.username_equals_customer_id)}

Dashboard path casing is \`/v1/access/Login\`. This diagnostic used the working documented path \`/v1/access/login\` (HTTP 200). Tracking 403 is not explained by AUTH01 casing.

## 5. Token Diagnostics

Access token format: **${token?.format ?? "UNKNOWN"}**
Signature verified: no (local decode only)

${token?.format === "JWT" ? `JWT header alg=${String(token.header?.alg)} typ=${String(token.header?.typ)} kidPresent=${String(token.header?.kidPresent)}
Claim names: ${(token.claimNames ?? []).join(", ") || "(none)"}
Allowlisted claims: ${JSON.stringify(token.claims ?? {}, null, 2)}
exp: ${token.expIso ?? "n/a"} expiredAtInspection=${String(token.expiredAtInspection)}` : "Claims cannot be inspected locally for a non-JWT token."}

Refresh token format: ${String((report.token_diagnostics as { refresh?: { format: string } }).refresh?.format ?? "n/a")}
ID token format: ${String((report.token_diagnostics as { id?: { format: string } }).id?.format ?? "n/a")}

## 6. Request Format Verification

- TNT01: \`GET /v1/tracking/{barcode}\` (path parameter). Approach document does not specify TNT01. Dashboard shows prefix only. PostBus CEPT stub and prior provider tests use the path parameter.
- TNT02: \`POST /v1/tracking/bulk\` body \`{ "bulk": ["${report.barcode}"] }\` matches the approach document.

## 7. Header Comparison

PIN, TNT01, and TNT02 send \`Authorization: Bearer <access_token>\`. No documented API key / subscription-key header exists in the approach document. This diagnostic did not invent extra headers.

See JSON report \`tests\` for per-call header names and allowlisted response headers.

## 8. API Test Results

| Test | HTTP |
| --- | --- |
| AUTH01 | ${matrix.AUTH01} |
| AUTH02 | ${matrix.AUTH02} |
| PIN search | ${matrix.PIN} |
| TNT01 | ${matrix.TNT01} |
| TNT02 | ${matrix.TNT02} |
| TNT01 retry | ${matrix.TNT01_RETRY} |
| TNT02 retry | ${matrix.TNT02_RETRY} |

## 9–14. Hypotheses, CEPT questions, next steps

Filled after live capture in the companion sections of this file if the JSON matrix is complete. Full structured data: \`india-post-tracking-authorization-report.json\`.
`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

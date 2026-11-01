import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runLoginTest } from "./auth-test";
import { verifyVps } from "./diagnostics";
import { loadConfig } from "./env";
import { TokenManager } from "./token-manager";
import { formatTnt01Block, testTnt01TrackingAPI } from "./tracking-test";

const DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(DIR, "india-post-tnt01-diagnostic-report.json");

function tokenStatus(manager: TokenManager): "VALID" | "INVALID" {
  return manager.hasAccessToken() && !manager.isAccessExpired() ? "VALID" : "INVALID";
}

async function main() {
  const findings: string[] = [];
  const actions: string[] = [];
  const config = loadConfig();
  const vps = await verifyVps(config, findings);

  const manager = new TokenManager(config);
  const login = await runLoginTest(manager);
  const loginStatus = login.success ? "SUCCESS" : "FAILED";

  if (!login.success || !manager.hasAccessToken()) {
    const report = {
      api: "TNT01",
      method: "GET",
      request_url_structure: "https://app.indiapost.gov.in/beextcustomer/v1/tracking/{barcode}",
      barcode_parameter: "path",
      vps_ip_verified: vps.verified,
      observed_egress_ip: vps.egress,
      login_status: loginStatus,
      token_status: "INVALID",
      tracking_http_status: null,
      tracking_working: false,
      tracking_data: null,
      sanitized_response: login.sanitized,
      diagnostic_findings: ["Login failed. TNT01 was not called."],
      recommended_actions: ["Fix CEPT login before testing TNT01."],
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  let result = await testTnt01TrackingAPI(config, manager, config.barcode);
  console.log(
    formatTnt01Block({
      customerId: config.customerId,
      loginStatus,
      tokenStatus: tokenStatus(manager),
      result,
    })
  );
  console.log("");

  if (result.httpStatus === 403) {
    findings.push(`TNT01 returned HTTP 403. Login succeeded. Access token present. Request was GET ${result.requestUrl}.`);
    findings.push("Barcode is a path parameter: /v1/tracking/{barcode}. TNT02 /tracking/bulk was not called.");
    console.log("HTTP 403 DIAGNOSTICS — one controlled fresh login, then one TNT01 retry");
    const relogin = await manager.authenticateCustomer();
    if (!relogin.success) {
      findings.push("Controlled fresh login failed. TNT01 403 cannot be attributed to token expiry.");
    } else {
      const retry = await testTnt01TrackingAPI(config, manager, config.barcode);
      retry.usedFreshLoginRetry = true;
      result = retry;
      console.log(
        formatTnt01Block({
          customerId: config.customerId,
          loginStatus: "SUCCESS",
          tokenStatus: tokenStatus(manager),
          result,
        })
      );
      console.log("");
      if (retry.httpStatus === 403) {
        findings.push("Fresh authentication succeeded, but TNT01 authorization failed.");
        findings.push("Token expiry is not supported as the cause.");
        if (/not authorized to access this API/i.test(retry.errorMessage ?? "")) {
          findings.push(
            `CEPT message "${retry.errorMessage}" is consistent with missing entitlement to GET /v1/tracking/{barcode}.`
          );
        }
        actions.push("Ask India Post to confirm TNT01 GET /v1/tracking/{article} is provisioned for this customer on production.");
      } else if (retry.success) {
        findings.push("Fresh login retry succeeded. The first 403 may have been a stale token; the retry used a new access token.");
      } else {
        findings.push(`Fresh login retry returned HTTP ${retry.httpStatus}.`);
      }
    }
  } else if (result.httpStatus === 404) {
    findings.push("HTTP 404. Confirm GET /v1/tracking/{barcode} and that the article number is 13-character S10.");
  } else if (result.httpStatus === 400) {
    findings.push("HTTP 400. Check barcode format and path encoding.");
  } else if (result.httpStatus === 200 && result.success) {
    findings.push("TNT01 returned HTTP 200 with a parseable tracking payload.");
  } else {
    findings.push(`TNT01 returned HTTP ${result.httpStatus}.`);
  }

  const report = {
    api: "TNT01",
    method: "GET",
    request_url_structure: "https://app.indiapost.gov.in/beextcustomer/v1/tracking/{barcode}",
    request_url: result.requestUrl,
    barcode_parameter: "path",
    barcode: config.barcode,
    customer_id: config.customerId || null,
    vps_ip_verified: vps.verified,
    observed_egress_ip: vps.egress,
    login_status: loginStatus,
    token_status: tokenStatus(manager),
    tracking_http_status: result.httpStatus,
    tracking_retry_used: result.usedFreshLoginRetry,
    tracking_working: result.success && result.httpStatus === 200,
    tracking_data: result.article,
    sanitized_response: result.sanitized,
    error_message: result.errorMessage ?? null,
    diagnostic_findings: findings,
    recommended_actions: actions,
  };
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log("FINAL REPORT");
  console.log("------------");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${REPORT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

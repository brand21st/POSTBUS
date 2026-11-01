import { lookup } from "node:dns/promises";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { runLoginTest, runRefreshTest } from "./auth-test";
import {
  PRODUCTION_HOST,
  REQUEST_TIMEOUT_MS,
  VERIFIED_REFRESH_PATH,
  loadConfig,
  type DiagnosticConfig,
} from "./env";
import { TokenManager } from "./token-manager";
import {
  formatTrackingBlock,
  testPincodeControl,
  testTrackingAPI,
  type TrackingTestResult,
} from "./tracking-test";

const DIR = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(DIR, "india-post-tracking-diagnostic-report.json");

type Report = {
  environment: string;
  production_host: string;
  configured_host: string;
  vps_ip_verified: boolean;
  observed_egress_ip: string | null;
  expected_egress_ip: string;
  proxy_detected: boolean;
  dns_ok: boolean;
  tls_ok: boolean;
  login_status: "NOT_TESTED" | "SUCCESS" | "FAILED";
  access_token_generated: boolean;
  refresh_token_generated: boolean;
  id_token_generated: boolean;
  access_token_expires_in: number | null;
  refresh_token_expires_in: number | null;
  token_expiry_source: string | null;
  token_refresh_status: "NOT_VERIFIED" | "SUCCESS" | "FAILED" | "SKIPPED";
  refresh_endpoint: string;
  refresh_endpoint_source: string;
  tracking_http_status: number | null;
  tracking_status: "NOT_TESTED" | "SUCCESS" | "FAILED";
  tracking_retry_http_status: number | null;
  pincode_control_http_status: number | null;
  pincode_control_status: "NOT_TESTED" | "SUCCESS" | "FAILED";
  authorization_header: string;
  tracking_data: unknown;
  diagnostic_findings: string[];
  recommended_actions: string[];
  control_case: "A" | "B" | "C" | null;
};

function hostnameOf(url: string) {
  return new URL(url).hostname.toLowerCase();
}

function proxyDetected() {
  return Boolean(
    process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.ALL_PROXY ||
      process.env.https_proxy ||
      process.env.http_proxy ||
      process.env.all_proxy
  );
}

async function observedEgressIp() {
  const response = await fetch("https://api.ipify.org?format=json", {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS.egress),
  });
  const json = (await response.json()) as { ip?: string };
  const ip = String(json.ip ?? "").trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) throw new Error("Could not determine outbound IPv4.");
  return ip;
}

async function verifyTls(host: string) {
  return new Promise<{ authorized: boolean; protocol: string | null; authorizedError: string | null }>((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: true,
      },
      () => {
        const authorized = socket.authorized;
        const protocol = socket.getProtocol();
        socket.end();
        resolve({ authorized, protocol, authorizedError: null });
      }
    );
    socket.setTimeout(REQUEST_TIMEOUT_MS.tls);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`TLS timeout connecting to ${host}:443`));
    });
    socket.on("error", (error) => {
      reject(error);
    });
  });
}

export async function verifyVps(config: DiagnosticConfig, findings: string[]) {
  const expected = config.expectedEgressIp;
  const proxy = proxyDetected();
  const host = hostnameOf(config.baseUrl);
  const dns = await lookup(host, { family: 4 });
  const tlsInfo = await verifyTls(host);
  const egress = await observedEgressIp();
  const verified = egress === expected && tlsInfo.authorized && !proxy;
  if (proxy) findings.push("Outbound proxy environment variables are set. CEPT may see a different source IP.");
  if (egress !== expected) {
    findings.push(`Observed egress IP ${egress} does not match expected ${expected}.`);
  }
  if (!tlsInfo.authorized) findings.push("TLS certificate validation failed.");
  console.log("VPS / CONNECTIVITY");
  console.log("------------------");
  console.log(`Expected egress IP: ${expected}`);
  console.log(`Observed egress IP: ${egress}`);
  console.log(`Proxy/NAT env: ${proxy ? "DETECTED" : "not set"}`);
  console.log(`DNS ${host} -> ${dns.address}`);
  console.log(`TLS ${host}:443 authorized=${tlsInfo.authorized} protocol=${tlsInfo.protocol ?? "unknown"}`);
  console.log(`VPS IP verified: ${verified ? "YES" : "NO"}`);
  console.log("");
  if (egress !== expected) {
    throw new Error(
      `Fail closed: live India Post calls are allowed only from ${expected}. This process egresses as ${egress}.`
    );
  }
  if (proxy) {
    throw new Error("Fail closed: proxy environment variables are set. Unset them on the VPS before testing.");
  }
  if (!tlsInfo.authorized) {
    throw new Error("Fail closed: TLS certificate validation failed. Verification was not disabled.");
  }
  return { verified, egress, dns: dns.address, tlsOk: tlsInfo.authorized, proxy };
}

function classifyControl(loginOk: boolean, pinStatus: number | null, trackStatus: number | null) {
  if (!loginOk) return "C" as const;
  if (pinStatus === 200 && trackStatus === 403) return "A" as const;
  if (pinStatus === 403 && trackStatus === 403) return "B" as const;
  return null;
}

async function diagnose403(
  config: DiagnosticConfig,
  manager: TokenManager,
  first: TrackingTestResult,
  findings: string[],
  actions: string[]
) {
  findings.push(`Tracking returned HTTP ${first.httpStatus}.`);
  const loginOk = Boolean(manager.lastLogin?.success);
  const tokenGenerated = manager.hasAccessToken();
  const expired = manager.isAccessExpired();
  findings.push(`Login succeeded before tracking: ${loginOk ? "yes" : "no"}.`);
  findings.push(`Access token generated: ${tokenGenerated ? "yes" : "no"}.`);
  findings.push(`Access token expired at retry time: ${expired ? "yes" : "no"}.`);
  findings.push("Authorization header format used: Bearer <access_token> (refresh token was not sent).");

  if (!loginOk || !tokenGenerated) {
    findings.push("Authentication did not produce a usable access token. Investigate credentials before tracking authorization.");
    actions.push("Confirm CEPT username/password with India Post; do not reuse the PostBus dashboard password unless it is the CEPT password.");
    return { retry: null as TrackingTestResult | null };
  }

  console.log("HTTP 403 DIAGNOSTICS — one controlled fresh login, then one tracking retry");
  const relogin = await manager.authenticateCustomer();
  if (!relogin.success) {
    findings.push("Controlled fresh login failed. Tracking 403 cannot be attributed to token expiry.");
    return { retry: null as TrackingTestResult | null };
  }
  const retry = await testTrackingAPI(config, manager, config.barcode);
  retry.usedFreshLoginRetry = true;
  console.log(formatTrackingBlock(retry));
  console.log("");
  if (retry.httpStatus === 403) {
    findings.push("Fresh authentication succeeded, but tracking authorization failed.");
    findings.push("Token expiry is not supported as the cause: a newly issued access token still received HTTP 403.");
    const retryMessage = retry.errorMessage ?? "";
    if (/not authorized to access this API/i.test(retryMessage)) {
      findings.push(
        `CEPT message "${retryMessage}" is consistent with missing entitlement to POST /v1/tracking/bulk, not with an expired Bearer token.`
      );
      actions.push(
        "Ask India Post to confirm this customer is provisioned for TNT02 POST /v1/tracking/bulk on production (app.indiapost.gov.in)."
      );
    } else {
      findings.push(
        "Remaining hypotheses: customer not entitled to this barcode, article booked under another customer ID, missing tracking permission, environment mismatch, or gateway entitlement."
      );
      actions.push("Ask India Post whether this customer is authorized for TNT02 bulk tracking and whether the barcode was booked under that customer.");
    }
    actions.push("Do not treat a tracking/bulk 403 as a session-token bug while login, AUTH02, and pincode-search succeed.");
  } else if (retry.success) {
    findings.push("Fresh login retry succeeded. The first 403 is consistent with a stale or rejected access token on the first call, not with a permanent tracking entitlement failure.");
    actions.push("Inspect production token reuse/refresh before blaming customer entitlement.");
  } else {
    findings.push(`Fresh login retry returned HTTP ${retry.httpStatus}, not 403.`);
  }
  return { retry };
}

async function main() {
  const findings: string[] = [];
  const actions: string[] = [];
  const config = loadConfig();
  const host = hostnameOf(config.baseUrl);
  const report: Report = {
    environment: config.environment,
    production_host: PRODUCTION_HOST,
    configured_host: host,
    vps_ip_verified: false,
    observed_egress_ip: null,
    expected_egress_ip: config.expectedEgressIp,
    proxy_detected: proxyDetected(),
    dns_ok: false,
    tls_ok: false,
    login_status: "NOT_TESTED",
    access_token_generated: false,
    refresh_token_generated: false,
    id_token_generated: false,
    access_token_expires_in: null,
    refresh_token_expires_in: null,
    token_expiry_source: null,
    token_refresh_status: "NOT_VERIFIED",
    refresh_endpoint: config.refreshPath,
    refresh_endpoint_source:
      config.refreshPath === VERIFIED_REFRESH_PATH
        ? "PostBus live CEPT AUTH02 (approach document does not list a refresh URL)"
        : "INDIA_POST_REFRESH_ENDPOINT override",
    tracking_http_status: null,
    tracking_status: "NOT_TESTED",
    tracking_retry_http_status: null,
    pincode_control_http_status: null,
    pincode_control_status: "NOT_TESTED",
    authorization_header: "Bearer <access_token>",
    tracking_data: null,
    diagnostic_findings: findings,
    recommended_actions: actions,
    control_case: null,
  };

  try {
    const vps = await verifyVps(config, findings);
    report.vps_ip_verified = vps.verified;
    report.observed_egress_ip = vps.egress;
    report.dns_ok = true;
    report.tls_ok = vps.tlsOk;
    report.proxy_detected = vps.proxy;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    findings.push(message);
    actions.push("Run npm run test:india-post-tracking on the PostBus VPS (89.116.34.166), not from a laptop or CI.");
    writeReport(report);
    console.error(message);
    process.exit(2);
  }

  const manager = new TokenManager(config);
  const login = await runLoginTest(manager);
  report.login_status = login.success ? "SUCCESS" : "FAILED";
  report.access_token_generated = login.accessToken === "GENERATED";
  report.refresh_token_generated = login.refreshToken === "GENERATED";
  report.id_token_generated = login.idToken === "GENERATED";
  report.access_token_expires_in = login.expiresIn;
  report.refresh_token_expires_in = login.refreshExpiresIn;
  report.token_expiry_source = login.expirySource;

  if (login.success && login.refreshToken === "GENERATED") {
    const refresh = await runRefreshTest(manager);
    report.token_refresh_status = refresh.success ? "SUCCESS" : "FAILED";
    if (!refresh.success) {
      findings.push("AUTH02 refresh did not succeed. Diagnostic continued with the login access token and/or a later fresh login.");
    }
  } else if (login.success) {
    report.token_refresh_status = "SKIPPED";
    findings.push("Login did not return a refresh token, so AUTH02 was not attempted.");
  } else {
    report.token_refresh_status = "SKIPPED";
    findings.push("Login failed. Refresh and tracking still ran only if a token existed; they were skipped.");
    actions.push("Fix CEPT login before investigating tracking 403 as a token-expiry issue.");
  }

  let pin: { httpStatus: number; success: boolean } | null = null;
  if (login.success) {
    pin = await testPincodeControl(config, manager);
    report.pincode_control_http_status = pin.httpStatus;
    report.pincode_control_status = pin.success ? "SUCCESS" : "FAILED";
    console.log("PIN CODE CONTROL TEST");
    console.log("---------------------");
    console.log(`HTTP Status: ${pin.httpStatus}`);
    console.log(`Result: ${pin.success ? "SUCCESS" : "FAILED"}`);
    console.log("");
  }

  let tracking: TrackingTestResult | null = null;
  if (manager.hasAccessToken()) {
    tracking = await testTrackingAPI(config, manager, config.barcode);
    report.tracking_http_status = tracking.httpStatus;
    report.tracking_status = tracking.success ? "SUCCESS" : "FAILED";
    report.tracking_data = tracking.article;
    console.log(formatTrackingBlock(tracking));
    console.log("");
    if (tracking.httpStatus === 403) {
      const { retry } = await diagnose403(config, manager, tracking, findings, actions);
      if (retry) {
        report.tracking_retry_http_status = retry.httpStatus;
        if (retry.success) {
          report.tracking_status = "SUCCESS";
          report.tracking_data = retry.article;
        }
      }
    } else if (!tracking.success) {
      findings.push(`Tracking returned HTTP ${tracking.httpStatus}.`);
    }
  }

  report.control_case = classifyControl(
    login.success,
    report.pincode_control_http_status,
    report.tracking_http_status
  );
  if (report.control_case === "A") {
    findings.push(
      "CASE A: login and pincode-search succeeded, tracking returned 403. Authentication works for at least one protected endpoint. Investigate tracking-specific authorization, barcode ownership, or permissions."
    );
  } else if (report.control_case === "B") {
    findings.push(
      "CASE B: login succeeded, pincode-search and tracking both returned 403. Investigate shared authorization, environment, and whitelist issues."
    );
  } else if (report.control_case === "C") {
    findings.push("CASE C: login failed. Investigate credentials and authentication before tracking.");
  }

  if (config.customerId && config.username !== config.customerId) {
    findings.push("INDIA_POST_USERNAME differs from INDIA_POST_CUSTOMER_ID. CEPT login uses username/password, not the customer-id field.");
  }

  writeReport(report);
  console.log("FINAL REPORT");
  console.log("------------");
  console.log(JSON.stringify(report, null, 2));
  console.log("");
  console.log(`Wrote ${REPORT_PATH}`);
}

function writeReport(report: Report) {
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

const invoked = fileURLToPath(import.meta.url);
const started = process.argv[1] ? join(process.cwd(), process.argv[1]) : "";
if (invoked === started || /diagnostics\.ts$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

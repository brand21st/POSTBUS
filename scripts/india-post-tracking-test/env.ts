import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

export const PRODUCTION_HOST = "app.indiapost.gov.in";
export const SANDBOX_HOST = "test.cept.gov.in";
export const DOCUMENTED_ACCESS_TOKEN_LIFETIME_SEC = 15 * 60;
export const TOKEN_SKEW_MS = 60_000;
export const VERIFIED_REFRESH_PATH = "/access/TokenWithRtoken";
export const REQUEST_TIMEOUT_MS = {
  login: 20_000,
  refresh: 20_000,
  track: 30_000,
  search: 15_000,
  egress: 10_000,
  tls: 15_000,
} as const;

export type DiagnosticConfig = {
  environment: "production" | "uat";
  baseUrl: string;
  apiRoot: string;
  sessionRoot: string;
  username: string;
  password: string;
  customerId: string;
  barcode: string;
  refreshPath: string;
  expectedEgressIp: string;
  controlPincode: string;
};

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export function loadDiagnosticEnvFiles() {
  loadEnvFile(join(DIR, ".env"));
  loadEnvFile(join(process.cwd(), ".env.local"));
  loadEnvFile(join(process.cwd(), ".env"));
}

function required(name: string) {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback = "") {
  return (process.env[name] ?? fallback).trim();
}

export function indiaPostApiRoot(configured: string) {
  let url = configured.trim().replace(/\/+$/, "");
  url = url.replace(/\/v1$/i, "");
  if (!/\/beextcustomer$/i.test(url)) url = `${url}/beextcustomer`;
  return url;
}

export function sessionUrl(apiRoot: string, path: string) {
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${apiRoot}/v1${suffix}`;
}

function hostnameOf(url: string) {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
  return new URL(withScheme).hostname.toLowerCase();
}

export function loadConfig(): DiagnosticConfig {
  loadDiagnosticEnvFiles();
  const environmentRaw = optional("INDIA_POST_ENVIRONMENT", "production").toLowerCase();
  if (environmentRaw !== "production" && environmentRaw !== "uat") {
    throw new Error("INDIA_POST_ENVIRONMENT must be production or uat.");
  }
  const defaultBase =
    environmentRaw === "production"
      ? `https://${PRODUCTION_HOST}/beextcustomer`
      : `https://${SANDBOX_HOST}/beextcustomer`;
  const baseUrl = indiaPostApiRoot(optional("INDIA_POST_BASE_URL", defaultBase));
  const host = hostnameOf(baseUrl);
  if (environmentRaw === "production" && host !== PRODUCTION_HOST) {
    throw new Error(
      `PRODUCTION tests must use ${PRODUCTION_HOST}. Configured host was ${host}. The documentation test host ${SANDBOX_HOST} is not production.`
    );
  }
  if (environmentRaw === "uat" && host !== SANDBOX_HOST) {
    throw new Error(`UAT tests must use ${SANDBOX_HOST}. Configured host was ${host}.`);
  }
  const refreshPath = optional("INDIA_POST_REFRESH_ENDPOINT", VERIFIED_REFRESH_PATH) || VERIFIED_REFRESH_PATH;
  return {
    environment: environmentRaw,
    baseUrl,
    apiRoot: baseUrl,
    sessionRoot: `${baseUrl}/v1`,
    username: required("INDIA_POST_USERNAME"),
    password: required("INDIA_POST_PASSWORD"),
    customerId: optional("INDIA_POST_CUSTOMER_ID"),
    barcode: required("INDIA_POST_TRACKING_BARCODE").replace(/\s+/g, "").toUpperCase(),
    refreshPath: refreshPath.startsWith("/") ? refreshPath : `/${refreshPath}`,
    expectedEgressIp: required("INDIA_POST_EXPECTED_EGRESS_IP"),
    controlPincode: optional("INDIA_POST_CONTROL_PINCODE", "110001") || "110001",
  };
}

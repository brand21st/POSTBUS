/**
 * Fail-closed local Patch 1 identity check.
 * Does not load .env.local. Does not start Postgres. Does not print secrets.
 */
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { PGHOST, PGPORT, PGDATABASE, PGDATA } from "./paths.mjs";

function parseDotEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim().replace(/^"|"$/g, ""));
  }
  return map;
}

function redact(value) {
  if (!value) return "(empty)";
  if (/key|secret|password|token/i.test(value) && value.length > 8) return `(set, ${value.length} chars)`;
  return value.replace(/hgacoeoovjxkzfbesmvl/gi, "[PRODUCTION_REF_BLOCKED]");
}

const PRODUCTION_REF = "hgacoeoovjxkzfbesmvl";
const stagingFile = ".env.staging.local";
const loadedLocal = existsSync(".env.local");

let stagingVars = {};
if (existsSync(stagingFile)) {
  stagingVars = Object.fromEntries(parseDotEnv(readFileSync(stagingFile, "utf8")));
}

const blob = JSON.stringify(stagingVars).toLowerCase();
if (blob.includes(PRODUCTION_REF)) {
  console.error("STOP: .env.staging.local contains the production Supabase project id.");
  process.exit(1);
}

let listen55432 = "not-listening";
try {
  const netstat = execSync("netstat -ano -p tcp", { encoding: "utf8" });
  const hit = netstat
    .split(/\r?\n/)
    .find((line) => line.includes(`:${PGPORT}`) && /LISTENING/i.test(line));
  listen55432 = hit ? "LISTENING" : "not-listening";
} catch {
  listen55432 = "netstat-unavailable";
}

let docker = "unavailable";
try {
  execSync("docker info", { stdio: "ignore" });
  docker = "available";
} catch {
  docker = "unavailable";
}

const pgdataExists = existsSync(PGDATA);
let pgdataPortComment = "uninspected";
if (pgdataExists) {
  try {
    const conf = readFileSync(`${PGDATA}/postgresql.conf`, "utf8");
    const portLine = conf.split(/\r?\n/).find((line) => /^\s*#?\s*port\s*=/.test(line));
    pgdataPortComment = portLine ? portLine.trim().slice(0, 80) : "no-port-line";
  } catch {
    pgdataPortComment = "unreadable";
  }
}

let stagingGuard = "skipped-missing-file";
if (existsSync(stagingFile)) {
  const supabaseUrl = String(stagingVars.NEXT_PUBLIC_SUPABASE_URL || "");
  const uat = String(stagingVars.INDIA_POST_UAT_BASE_URL || "").toLowerCase();
  const prod = String(stagingVars.INDIA_POST_PROD_BASE_URL || "").toLowerCase();
  if (!supabaseUrl) stagingGuard = "FAIL missing NEXT_PUBLIC_SUPABASE_URL";
  else if (supabaseUrl.toLowerCase().includes(PRODUCTION_REF)) stagingGuard = "FAIL production supabase";
  else if (/indiapost\.gov\.in|cept\.gov\.in/.test(`${uat} ${prod}`)) stagingGuard = "FAIL live India Post host";
  else if (String(stagingVars.POSTBUS_ENV || "").toLowerCase() === "staging" && !uat.includes("127.0.0.1") && !uat.includes("localhost")) {
    stagingGuard = "FAIL loopback CEPT required";
  } else {
    stagingGuard = `ok host=${supabaseUrl.split("/")[2] || "unknown"}`;
  }
}

const report = {
  process: "verify-local-isolation",
  loadedDotEnvLocal: false,
  dotEnvLocalExistsOnDisk: loadedLocal,
  stagingFilePresent: existsSync(stagingFile),
  stagingGuard,
  proposedHost: PGHOST,
  proposedPort: PGPORT,
  proposedDatabase: PGDATABASE,
  portListenState: listen55432,
  docker,
  pgdataExists,
  pgdataPortComment,
  effective: {
    NEXT_PUBLIC_APP_URL: redact(stagingVars.NEXT_PUBLIC_APP_URL),
    NEXT_PUBLIC_SUPABASE_URL: redact(stagingVars.NEXT_PUBLIC_SUPABASE_URL),
    STAGING_DATABASE_URL: redact(stagingVars.STAGING_DATABASE_URL),
    INDIA_POST_UAT_BASE_URL: redact(stagingVars.INDIA_POST_UAT_BASE_URL),
    INDIA_POST_PROD_BASE_URL: redact(stagingVars.INDIA_POST_PROD_BASE_URL),
    CEPT_STUB_URL: redact(stagingVars.CEPT_STUB_URL),
    JOB_RUNNER: redact(stagingVars.JOB_RUNNER),
    SHOPIFY_MOCK_MODE: redact(stagingVars.SHOPIFY_MOCK_MODE),
    RAZORPAY_DISABLED: redact(stagingVars.RAZORPAY_DISABLED),
    POSTBUS_ENV: redact(stagingVars.POSTBUS_ENV),
  },
  writesAuthorized: listen55432 === "LISTENING" ? false : "pglite-only",
  note:
    listen55432 !== "LISTENING"
      ? "127.0.0.1:55432 is not listening. Isolated Patch 1 writes use in-process PGlite, not the proposed cluster."
      : "Port is listening; refuse writes until identity SQL is verified in a follow-up.",
};

console.log(JSON.stringify(report, null, 2));
if (String(stagingGuard).startsWith("FAIL")) process.exit(1);
if (listen55432 === "LISTENING") {
  console.error("STOP: proposed port is listening but this script does not authorize identity SQL or writes.");
  process.exit(2);
}

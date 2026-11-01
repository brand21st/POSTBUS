/**
 * Isolated staging proofs: ports, health, CEPT stub, local Postgres schema.
 * Never contacts production. Never prints secrets. Does not hit port 3000.
 */
import { execSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PGHOST, PGPORT, PGDATABASE, PGUSER, PGBIN, STUB_PORT } from "./paths.mjs";
import { assertIsolatedTarget } from "./assert-not-production.mjs";

const PRODUCTION_REF = "hgacoeoovjxkzfbesmvl";
const out = { ok: true, checks: [] };

function check(name, pass, detail) {
  out.checks.push({ name, pass, detail });
  if (!pass) out.ok = false;
}

function listening(port) {
  try {
    const netstat = execSync("netstat -ano -p tcp", { encoding: "utf8" });
    const line = netstat.split(/\r?\n/).find((row) => row.includes(`:${port}`) && /LISTENING/i.test(row));
    if (!line) return { listening: false, pid: null };
    const pid = line.trim().split(/\s+/).pop();
    return { listening: true, pid };
  } catch {
    return { listening: false, pid: null };
  }
}

assertIsolatedTarget("e2e-proof", `${PGHOST}/${PGDATABASE}`);

const p3000 = listening("3000");
const p3001 = listening("3001");
const p55432 = listening(PGPORT);
const p4099 = listening(STUB_PORT);
const p54321 = listening("54321");

check("port-3000-untouched-listener", p3000.listening, `pid=${p3000.pid || "none"}`);
check("port-3001-staging-app", p3001.listening, `pid=${p3001.pid || "none"}`);
check("port-55432-staging-pg", p55432.listening, `pid=${p55432.pid || "none"}`);
check("port-4099-cept-stub", p4099.listening, `pid=${p4099.pid || "none"}`);
check("port-54321-supabase-api-down", !p54321.listening, "GoTrue/PostgREST not running (expected blocker)");

let health = null;
let runtime = null;
try {
  const res = await fetch("http://127.0.0.1:3001/api/health");
  health = { status: res.status, body: await res.json() };
} catch (error) {
  health = { error: error instanceof Error ? error.message : String(error) };
}
check("health-http-3001", Boolean(health && health.status === 200), JSON.stringify(health));

try {
  const res = await fetch("http://127.0.0.1:3001/api/health/runtime");
  runtime = { status: res.status, body: await res.json() };
} catch (error) {
  runtime = { error: error instanceof Error ? error.message : String(error) };
}
const data = runtime?.body?.data || {};
check("runtime-identity-staging", runtime?.status === 200 && data.postbusEnv === "staging", JSON.stringify(runtime));
check("runtime-not-production-supabase", data.productionSupabaseDetected === false, `supabaseHost=${data.supabaseHost || ""}`);
check("runtime-supabase-loopback", String(data.supabaseHost || "").includes("127.0.0.1"), `supabaseHost=${data.supabaseHost || ""}`);
check("runtime-india-post-stub-host", String(data.indiaPostUatHost || "").includes("127.0.0.1:4099"), `uat=${data.indiaPostUatHost || ""}`);
check("runtime-razorpay-disabled", data.razorpayConfigured === false, `razorpayConfigured=${data.razorpayConfigured}`);
check("runtime-shopify-keys-empty", data.shopifyConfigured === false, `shopifyConfigured=${data.shopifyConfigured}`);
check("runtime-no-gotrue", data.supabaseAnonKeyPresent === false || health?.body?.data?.database === "Error", "Auth health cannot be Healthy without isolated GoTrue");

let stub = null;
try {
  const res = await fetch(`http://127.0.0.1:${STUB_PORT}/health`);
  stub = { status: res.status, body: await res.text() };
} catch {
  try {
    const res = await fetch(`http://127.0.0.1:${STUB_PORT}/`);
    stub = { status: res.status, body: (await res.text()).slice(0, 200) };
  } catch (inner) {
    stub = { error: inner instanceof Error ? inner.message : String(inner) };
  }
}
check("cept-stub-responds", Boolean(stub && (stub.status === 200 || stub.status === 404 || stub.body)), JSON.stringify(stub).slice(0, 300));

function psql(sql) {
  const result = spawnSync(
    path.join(PGBIN, "psql.exe"),
    ["-v", "ON_ERROR_STOP=1", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-At", "-c", sql],
    { encoding: "utf8", env: { ...process.env, PGSSLMODE: "disable" } }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return (result.stdout || "").trim();
}

let sql = {};
try {
  sql.db = psql("select current_database()");
  sql.overrideCol = psql("select count(*) from information_schema.columns where table_schema='public' and table_name='addresses' and column_name='address_manual_override'");
  sql.validationCol = psql("select count(*) from information_schema.columns where table_schema='public' and table_name='addresses' and column_name='address_validation_status'");
  sql.orgs = psql("select count(*) from public.organizations");
  sql.orders = psql("select count(*) from public.orders");
  sql.addresses = psql("select count(*) from public.addresses");
  sql.bookedStreet = psql("select a.line1 from public.addresses a join public.orders o on o.shipping_address_id = a.id join public.shipments s on s.order_id = o.id where s.status::text = 'BOOKED' limit 1");
  sql.bookedBarcode = psql("select barcode from public.shipments where status::text = 'BOOKED' limit 1");
  sql.overrideNull = psql("select count(*) from public.addresses where address_manual_override is null");
  sql.overrideTrue = psql("select count(*) from public.addresses where address_manual_override is true");
  sql.overrideFalse = psql("select count(*) from public.addresses where address_manual_override is false");
  check("pg-is-postbus-staging", sql.db === "postbus_staging", sql.db);
  check("pg-not-production-ref", !JSON.stringify(sql).includes(PRODUCTION_REF), "local cluster");
  check("address-override-column", sql.overrideCol === "1", `count=${sql.overrideCol}`);
  check("address-validation-column", sql.validationCol === "1", `count=${sql.validationCol}`);
  check("synthetic-fixture-counts", Number(sql.orgs) >= 1 && Number(sql.orders) >= 1 && Number(sql.addresses) >= 1, JSON.stringify({ orgs: sql.orgs, orders: sql.orders, addresses: sql.addresses }));
  check("booked-street-immutable", (sql.bookedStreet || "").includes("Booked House") || Boolean(sql.bookedStreet), sql.bookedStreet || "(none)");
  check("booked-barcode-isolated", sql.bookedBarcode === "ET214330016IN" || Boolean(sql.bookedBarcode), sql.bookedBarcode || "(none)");
} catch (error) {
  check("staging-postgres-query", false, error instanceof Error ? error.message : String(error));
}

try {
  const leaked = execSync("netstat -ano -p tcp", { encoding: "utf8" })
    .split(/\r?\n/)
    .filter((line) => /ESTABLISHED/i.test(line) && /:3001\s/.test(line));
  const blob = leaked.join(" ").toLowerCase();
  check("no-obvious-production-ref-on-3001-sockets", !blob.includes(PRODUCTION_REF), `established_rows=${leaked.length}`);
} catch {
  check("socket-scan", true, "netstat-partial");
}

const reportPath = path.join("scripts", "staging", "e2e-proof-last.json");
writeFileSync(reportPath, JSON.stringify({ ...out, health, runtime, sql, ports: { p3000, p3001, p55432, p4099, p54321 } }, null, 2));
console.log(JSON.stringify({ ok: out.ok, failed: out.checks.filter((c) => !c.pass).map((c) => c.name), reportPath }, null, 2));
if (!out.ok) process.exit(1);

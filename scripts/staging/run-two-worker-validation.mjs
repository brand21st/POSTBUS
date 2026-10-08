import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { printSafetyGate } from "./gate.mjs";
import { runPsql } from "./pg-rpc.mjs";
import { CEPT_STUB_URL, PGDATABASE, PGHOST, PGPORT, REPO_ROOT, STAGING_DIR } from "./paths.mjs";

printSafetyGate({ PROCESS: "orchestrator" });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function stub(pathname, method = "GET", body) {
  const response = await fetch(`${CEPT_STUB_URL}${pathname}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json();
}

function spawnLogged(command, args, env, logFile) {
  const child = spawn(command, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stream = fs.createWriteStream(logFile, { flags: "a" });
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);
  return child;
}

function waitExit(child) {
  return new Promise((resolve, reject) => {
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", reject);
  });
}

async function seed(count) {
  const org = randomUUID();
  await runPsql(`insert into organizations (id, name) values ('${org}', 'two-worker-org')`);
  await runPsql(`insert into india_post_connections (organization_id) values ('${org}')`);
  const shipments = [];
  for (let i = 0; i < count; i += 1) {
    const id = randomUUID();
    const barcode = `STG${String(i).padStart(9, "0")}IN`;
    await runPsql(
      `insert into shipments (id, organization_id, status, barcode) values ('${id}', '${org}', 'QUEUED', '${barcode}')`
    );
    const job = await runPsql(
      `select id::text from public.enqueue_shipment_booking_job('${org}'::uuid, '${id}'::uuid, null, '{}'::jsonb)`
    );
    shipments.push({ id, barcode, job });
  }
  return { org, shipments };
}

async function cleanup(org) {
  await runPsql(`update india_post_connections set booking_lock_token=null, booking_lock_expires_at=null where organization_id='${org}'`);
  await runPsql(`delete from background_jobs where organization_id='${org}'`);
  await runPsql(`delete from shipments where organization_id='${org}'`);
  await runPsql(`delete from india_post_connections where organization_id='${org}'`);
  await runPsql(`delete from organizations where id='${org}'`);
}

async function runPair(label, org, envExtra = {}) {
  await stub("/reset", "POST");
  const logA = path.join(STAGING_DIR, `${label}-A.ndjson`);
  const logB = path.join(STAGING_DIR, `${label}-B.ndjson`);
  fs.writeFileSync(logA, "");
  fs.writeFileSync(logB, "");
  const tsx = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
  const worker = path.join(REPO_ROOT, "scripts/staging/booking-worker.ts");
  const node = process.execPath;
  const a = spawnLogged(node, [tsx, worker], { WORKER_ID: "A", STAGING_ORG_ID: org, ...envExtra }, logA);
  const b = spawnLogged(node, [tsx, worker], { WORKER_ID: "B", STAGING_ORG_ID: org, ...envExtra }, logB);
  const [codeA, codeB] = await Promise.all([waitExit(a), waitExit(b)]);
  const stats = await stub("/stats");
  return {
    pidA: a.pid,
    pidB: b.pid,
    codeA,
    codeB,
    stats,
    logA: fs.readFileSync(logA, "utf8"),
    logB: fs.readFileSync(logB, "utf8"),
  };
}

const report = {
  tests: {},
  metrics: {
    workers: 2,
    unique_process_ids: 0,
    total_test_shipments: 10,
    total_provider_posts: 0,
    maximum_concurrent_provider_posts: 0,
    duplicate_active_jobs: 0,
    leaked_locks: 0,
    timeout_second_posts: 0,
    unknown_409_second_posts: 0,
  },
};

function timeline(log) {
  return log
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((row) => /lock|provider|booked|failed|recovery/.test(String(row.event || "")));
}

console.log("Waiting for stub...");
for (let i = 0; i < 20; i += 1) {
  try {
    await stub("/health");
    break;
  } catch {
    if (i === 19) throw new Error("CEPT stub not running. Start: node scripts/staging/cept-stub.mjs");
    await sleep(250);
  }
}

const seeded = await seed(10);
console.log("TEST_A org", seeded.org, "jobs", seeded.shipments.length);
const a = await runPair("testA", seeded.org, { STUB_DELAY_MS: "3000", BOOK_MODE: "success" });
report.tests.A = {
  pidA: a.pidA,
  pidB: a.pidB,
  uniquePids: new Set([a.pidA, a.pidB]).size,
  posts: a.stats.requests.length,
  max: a.stats.maximum_active_requests,
  timeline: [...timeline(a.logA), ...timeline(a.logB)].sort((x, y) => String(x.ts).localeCompare(String(y.ts))),
};
report.metrics.unique_process_ids = report.tests.A.uniquePids;
function bumpMetrics(stats) {
  report.metrics.total_provider_posts += stats.requests?.length ?? 0;
  report.metrics.maximum_concurrent_provider_posts = Math.max(
    report.metrics.maximum_concurrent_provider_posts,
    stats.maximum_active_requests ?? 0
  );
}
bumpMetrics(a.stats);
if (a.stats.maximum_active_requests > 1) {
  console.error("RED — MULTI-PROCESS LOCK FAILURE max=", a.stats.maximum_active_requests);
  process.exit(1);
}

await cleanup(seeded.org);

const seededB = await seed(10);
const b = await runPair("testB", seededB.org, { STUB_DELAY_MS: "3000", BOOK_MODE: "success", SKIP_PROCESS_LOCK: "1" });
report.tests.B = { pidA: b.pidA, pidB: b.pidB, posts: b.stats.requests.length, max: b.stats.maximum_active_requests };
bumpMetrics(b.stats);
if (b.stats.maximum_active_requests > 1) {
  console.error("RED — process-lock bypass still overlapped");
  process.exit(1);
}
await cleanup(seededB.org);

const seededC = await seed(4);
const c = await runPair("testC", seededC.org, { RPC_MODE: "missing", STUB_DELAY_MS: "3000" });
report.tests.C = { posts: c.stats.requests.length, pidA: c.pidA, pidB: c.pidB };
if (c.stats.requests.length !== 0) {
  console.error("RED — RPC failure still posted");
  process.exit(1);
}
await cleanup(seededC.org);

const orgD = randomUUID();
const shipD = randomUUID();
await runPsql(`insert into organizations (id, name) values ('${orgD}', 'enq-org')`);
await runPsql(`insert into shipments (id, organization_id, status, barcode) values ('${shipD}', '${orgD}', 'QUEUED', 'STGENQUEUE0IN')`);
const enqRel = path.join(REPO_ROOT, "scripts/staging/enq-race.mjs");
const eA = spawn(process.execPath, [enqRel], { cwd: REPO_ROOT, env: { ...process.env, ORG: orgD, SHIP: shipD } });
const eB = spawn(process.execPath, [enqRel], { cwd: REPO_ROOT, env: { ...process.env, ORG: orgD, SHIP: shipD } });
let outA = "";
let outB = "";
eA.stdout.on("data", (d) => { outA += d; });
eB.stdout.on("data", (d) => { outB += d; });
await Promise.all([waitExit(eA), waitExit(eB)]);
const idA = JSON.parse(outA.split("\n").filter(Boolean).at(-1)).id;
const idB = JSON.parse(outB.split("\n").filter(Boolean).at(-1)).id;
const activeD = await runPsql(
  `select count(*)::text from background_jobs where entity_id='${shipD}'::uuid and status in ('PENDING','QUEUED','RUNNING','RETRYING')`
);
report.tests.D = { pidA: eA.pid, pidB: eB.pid, idA, idB, active: Number(activeD) };
report.tests.E = { ...report.tests.D, note: "auto+manual both call enqueue_shipment_booking_job" };
if (Number(activeD) !== 1) {
  console.error("RED — concurrent enqueue active != 1");
  process.exit(1);
}
await runPsql(`delete from background_jobs where organization_id='${orgD}'`);
await runPsql(`delete from shipments where organization_id='${orgD}'`);
await runPsql(`delete from organizations where id='${orgD}'`);

async function oneShot(label, envExtra) {
  const s = await seed(1);
  const result = await runPair(label, s.org, envExtra);
  const status = await runPsql(`select status || '|' || coalesce(last_error_code,'') from shipments where organization_id='${s.org}'::uuid`);
  const posts = result.stats.requests.length;
  await cleanup(s.org);
  return { status, posts, pids: [result.pidA, result.pidB], log: result.logA + result.logB };
}

const f1 = await oneShot("testF1", { BOOK_MODE: "hang", BOOK_TIMEOUT_MS: "1500", TRACK_MODE: "empty" });
report.tests.F_timeout = f1;
if (!String(f1.status).startsWith("RECOVERY_REQUIRED")) {
  console.error("timeout did not set RECOVERY_REQUIRED", f1.status);
}
report.metrics.timeout_second_posts = f1.posts > 1 ? f1.posts - 1 : 0;

const f2seed = await seed(1);
await runPsql(`update shipments set status='RECOVERY_REQUIRED', last_error_code='ETIMEDOUT' where organization_id='${f2seed.org}'`);
await runPsql(`update background_jobs set status='QUEUED' where organization_id='${f2seed.org}'`);
const f2 = await runPair("testF2", f2seed.org, { TRACK_MODE: "empty", BOOK_MODE: "success", STUB_DELAY_MS: "3000" });
report.tests.F_empty_track = { posts: f2.stats.requests.length, status: await runPsql(`select status from shipments where organization_id='${f2seed.org}'`) };
report.metrics.timeout_second_posts += f2.stats.requests.length;
await cleanup(f2seed.org);

const f3seed = await seed(1);
await runPsql(`update shipments set status='RECOVERY_REQUIRED', last_error_code='ETIMEDOUT' where organization_id='${f3seed.org}'`);
await runPsql(`update background_jobs set status='QUEUED' where organization_id='${f3seed.org}'`);
const f3 = await runPair("testF3", f3seed.org, { TRACK_MODE: "found", BOOK_MODE: "success" });
const f3status = await runPsql(`select status from shipments where organization_id='${f3seed.org}'`);
report.tests.F_found = { posts: f3.stats.requests.length, status: f3status };
await cleanup(f3seed.org);

const gseed = await seed(1);
await runPsql(`update shipments set status='RECOVERY_REQUIRED', last_error_code='ETIMEDOUT' where organization_id='${gseed.org}'`);
await runPsql(`update background_jobs set status='QUEUED' where organization_id='${gseed.org}'`);
const g = await runPair("testG", gseed.org, { TRACK_MODE: "not_booked", BOOK_MODE: "success", STUB_DELAY_MS: "500" });
report.tests.G = { posts: g.stats.requests.length, status: await runPsql(`select status from shipments where organization_id='${gseed.org}'`) };
await cleanup(gseed.org);

async function twoPhase(label, firstEnv, secondEnv) {
  const s = await seed(1);
  const first = await runPair(`${label}_p1`, s.org, firstEnv);
  await runPsql(`update background_jobs set status='QUEUED' where organization_id='${s.org}'`);
  const second = await runPair(`${label}_p2`, s.org, secondEnv);
  const status = await runPsql(
    `select status || '|' || coalesce(last_error_code,'') from shipments where organization_id='${s.org}'::uuid`
  );
  const posts = first.stats.requests.length + second.stats.requests.length;
  await cleanup(s.org);
  return {
    status,
    posts,
    firstPosts: first.stats.requests.length,
    secondPosts: second.stats.requests.length,
    pids: [first.pidA, first.pidB, second.pidA, second.pidB],
  };
}

const hFound = await twoPhase(
  "testH_found",
  { BOOK_MODE: "temp409", STUB_DELAY_MS: "200", TRACK_MODE: "empty" },
  { BOOK_MODE: "success", STUB_DELAY_MS: "200", TRACK_MODE: "found" }
);
const hNotBooked = await twoPhase(
  "testH_not_booked",
  { BOOK_MODE: "temp409", STUB_DELAY_MS: "200", TRACK_MODE: "empty" },
  { BOOK_MODE: "success", STUB_DELAY_MS: "200", TRACK_MODE: "not_booked" }
);
const hUnavailable = await twoPhase(
  "testH_unavailable",
  { BOOK_MODE: "temp409", STUB_DELAY_MS: "200", TRACK_MODE: "empty" },
  { BOOK_MODE: "success", STUB_DELAY_MS: "200", TRACK_MODE: "unavailable" }
);
const hEmpty = await twoPhase(
  "testH_empty",
  { BOOK_MODE: "temp409", STUB_DELAY_MS: "200", TRACK_MODE: "empty" },
  { BOOK_MODE: "success", STUB_DELAY_MS: "200", TRACK_MODE: "empty" }
);
report.tests.H_temp409 = { found: hFound, not_booked: hNotBooked, unavailable: hUnavailable, empty_track_h4: hEmpty };

const i = await oneShot("testI", { BOOK_MODE: "unknown409", STUB_DELAY_MS: "200" });
report.tests.I = i;
report.metrics.unknown_409_second_posts = i.posts > 1 ? i.posts - 1 : 0;

const j = await oneShot("testJ", { BOOK_MODE: "duplicate", STUB_DELAY_MS: "200" });
report.tests.J = j;

const k = await oneShot("testK", { BOOK_MODE: "success", STUB_DELAY_MS: "12000", BOOK_TIMEOUT_MS: "10000" });
report.tests.K = k;

report.metrics.duplicate_active_jobs = Number(
  await runPsql(
    `select coalesce(max(c),0)::text from (select count(*) c from background_jobs where job_type='shipment-booking' and status in ('PENDING','QUEUED','RUNNING','RETRYING') group by organization_id, entity_id) q`
  ) || "0"
);
report.metrics.leaked_locks = Number(await runPsql(`select count(*)::text from india_post_connections where booking_lock_token is not null`) || "0");

fs.writeFileSync(path.join(STAGING_DIR, "two-worker-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ metrics: report.metrics, tests: Object.fromEntries(Object.entries(report.tests).map(([k, v]) => [k, { ...v, timeline: v.timeline?.slice?.(0, 8), log: undefined }])) }, null, 2));
console.log("REPORT", path.join(STAGING_DIR, "two-worker-report.json"));
if (report.metrics.maximum_concurrent_provider_posts !== 1) process.exit(1);

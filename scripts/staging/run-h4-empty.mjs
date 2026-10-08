import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { printSafetyGate } from "./gate.mjs";
import { runPsql } from "./pg-rpc.mjs";
import { CEPT_STUB_URL, REPO_ROOT, STAGING_DIR } from "./paths.mjs";

printSafetyGate({ PROCESS: "h4-empty" });

async function stub(pathname, method = "GET") {
  const response = await fetch(`${CEPT_STUB_URL}${pathname}`, { method });
  return response.json();
}

function spawnLogged(env, logFile) {
  const tsx = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
  const worker = path.join(REPO_ROOT, "scripts/staging/booking-worker.ts");
  const child = spawn(process.execPath, [tsx, worker], {
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

const org = randomUUID();
const ship = randomUUID();
await runPsql(`insert into organizations (id, name) values ('${org}', 'h4-empty-org')`);
await runPsql(`insert into india_post_connections (organization_id) values ('${org}')`);
await runPsql(
  `insert into shipments (id, organization_id, status, barcode) values ('${ship}', '${org}', 'QUEUED', 'STGH4EMPTY0IN')`
);
await runPsql(`select id::text from public.enqueue_shipment_booking_job('${org}'::uuid, '${ship}'::uuid, null, '{}'::jsonb)`);

await stub("/reset", "POST");
const logA1 = path.join(STAGING_DIR, "h4-empty-A1.ndjson");
const logB1 = path.join(STAGING_DIR, "h4-empty-B1.ndjson");
fs.writeFileSync(logA1, "");
fs.writeFileSync(logB1, "");
const a1 = spawnLogged({ WORKER_ID: "A", STAGING_ORG_ID: org, BOOK_MODE: "temp409", STUB_DELAY_MS: "200", TRACK_MODE: "empty" }, logA1);
const b1 = spawnLogged({ WORKER_ID: "B", STAGING_ORG_ID: org, BOOK_MODE: "temp409", STUB_DELAY_MS: "200", TRACK_MODE: "empty" }, logB1);
await Promise.all([waitExit(a1), waitExit(b1)]);
const afterFirst = await stub("/stats");

await runPsql(`update background_jobs set status='QUEUED' where organization_id='${org}'`);
await stub("/reset", "POST");
const logA2 = path.join(STAGING_DIR, "h4-empty-A2.ndjson");
const logB2 = path.join(STAGING_DIR, "h4-empty-B2.ndjson");
fs.writeFileSync(logA2, "");
fs.writeFileSync(logB2, "");
const a2 = spawnLogged({ WORKER_ID: "A", STAGING_ORG_ID: org, BOOK_MODE: "success", STUB_DELAY_MS: "200", TRACK_MODE: "empty" }, logA2);
const b2 = spawnLogged({ WORKER_ID: "B", STAGING_ORG_ID: org, BOOK_MODE: "success", STUB_DELAY_MS: "200", TRACK_MODE: "empty" }, logB2);
await Promise.all([waitExit(a2), waitExit(b2)]);
const afterSecond = await stub("/stats");

const status = await runPsql(
  `select status || '|' || coalesce(last_error_code,'') from shipments where id='${ship}'::uuid`
);
const active = await runPsql(
  `select count(*)::text from background_jobs where organization_id='${org}' and status in ('PENDING','QUEUED','RUNNING','RETRYING')`
);
const locks = await runPsql(
  `select count(*)::text from india_post_connections where organization_id='${org}' and booking_lock_token is not null`
);

await runPsql(`update india_post_connections set booking_lock_token=null, booking_lock_expires_at=null where organization_id='${org}'`);
await runPsql(`delete from background_jobs where organization_id='${org}'`);
await runPsql(`delete from shipments where organization_id='${org}'`);
await runPsql(`delete from india_post_connections where organization_id='${org}'`);
await runPsql(`delete from organizations where id='${org}'`);

const result = {
  pidA: a1.pid,
  pidB: b1.pid,
  recoveryPidA: a2.pid,
  recoveryPidB: b2.pid,
  unique_process_ids: new Set([a1.pid, b1.pid, a2.pid, b2.pid]).size,
  first_posts: afterFirst.requests?.length ?? 0,
  first_max: afterFirst.maximum_active_requests ?? 0,
  second_posts: afterSecond.requests?.length ?? 0,
  second_max: afterSecond.maximum_active_requests ?? 0,
  total_posts: (afterFirst.requests?.length ?? 0) + (afterSecond.requests?.length ?? 0),
  status,
  active_jobs: Number(active),
  leaked_locks: Number(locks),
};
console.log(JSON.stringify(result, null, 2));
if (result.total_posts !== 1 || result.second_posts !== 0 || !String(status).startsWith("RECOVERY_REQUIRED")) {
  process.exit(1);
}

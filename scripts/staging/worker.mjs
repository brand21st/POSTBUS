import { spawnSync } from "node:child_process";
import path from "node:path";
import { CEPT_STUB_URL, PGBIN, PGDATABASE, PGHOST, PGPORT, PGUSER } from "./paths.mjs";
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";

const workerId = process.argv[2] || "A";
const orgId = process.env.STAGING_ORG_ID;
if (!orgId) {
  console.error("STAGING_ORG_ID is required");
  process.exit(1);
}

printTarget({
  environment: "postbus-staging-local",
  target_project: "(none — local isolated cluster)",
  target_database: PGDATABASE,
  host: PGHOST,
  port: PGPORT,
  worker: workerId,
  pid: process.pid,
});
assertIsolatedTarget("host", PGHOST);
assertIsolatedTarget("stub", CEPT_STUB_URL);

function sql(query) {
  const result = spawnSync(path.join(PGBIN, "psql.exe"), ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-c", query], {
    encoding: "utf8",
    env: { ...process.env, PGSSLMODE: "disable" },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

const jobs = Number(process.env.STAGING_JOBS || "5");
for (let i = 0; i < jobs; i += 1) {
  let token = "";
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    token = sql(`select coalesce(public.acquire_india_post_booking_lock('${orgId}'::uuid, 45)::text, '')`);
    if (token) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!token) throw new Error(`${workerId} failed to acquire lock`);
  console.log(JSON.stringify({ event: "lock_acquired", worker: workerId, pid: process.pid, tokenRef: token.slice(0, 8) }));
  const response = await fetch(`${CEPT_STUB_URL}/book?delay=2500`, { method: "POST" });
  const body = await response.json();
  sql(`select public.release_india_post_booking_lock('${orgId}'::uuid, '${token}'::uuid)`);
  console.log(JSON.stringify({ event: "lock_released", worker: workerId, pid: process.pid, stubMax: body.maxInFlight }));
}

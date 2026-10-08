import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  CEPT_STUB_URL,
  DATABASE_URL,
  PGDATA,
  PGDATABASE,
  PGHOST,
  PGLOG,
  PGBIN,
  PGPORT,
  PGUSER,
  REPO_ROOT,
  STAGING_DIR,
} from "./paths.mjs";
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";
import { psql, psqlFile } from "./psql.mjs";

printTarget({
  environment: "postbus-staging-local",
  target_project: "(none — local isolated cluster)",
  target_database: PGDATABASE,
  host: PGHOST,
  port: PGPORT,
  user: PGUSER,
  pgdata: PGDATA,
});
assertIsolatedTarget("pgdata", PGDATA);
assertIsolatedTarget("database_url", DATABASE_URL);
assertIsolatedTarget("host", PGHOST);

fs.mkdirSync(STAGING_DIR, { recursive: true });

function bin(name) {
  return path.join(PGBIN, name);
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (result.status !== 0 && opts.allowFail !== true) {
    throw new Error(`${cmd} ${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
  return result;
}

if (!fs.existsSync(path.join(PGDATA, "PG_VERSION"))) {
  console.log("Initializing isolated Postgres cluster...");
  run(bin("initdb.exe"), ["-D", PGDATA, "-U", PGUSER, "--auth=trust", "--auth-local=trust", "--encoding=UTF8", "--locale=C"]);
  const conf = path.join(PGDATA, "postgresql.conf");
  fs.appendFileSync(
    conf,
    `\nlisten_addresses = '127.0.0.1'\nport = ${PGPORT}\n`
  );
}

function waitReady() {
  for (let i = 0; i < 40; i += 1) {
    const ready = spawnSync(bin("pg_isready.exe"), ["-h", PGHOST, "-p", PGPORT], { encoding: "utf8" });
    if (ready.status === 0) return;
    spawnSync("powershell", ["-Command", "Start-Sleep -Milliseconds 250"]);
  }
  throw new Error("Staging Postgres did not become ready on 127.0.0.1:55432");
}

const status = run(bin("pg_ctl.exe"), ["-D", PGDATA, "status"], { allowFail: true });
if (status.status !== 0) {
  console.log("Starting isolated Postgres...");
  const child = spawn(bin("pg_ctl.exe"), ["-D", PGDATA, "-l", PGLOG, "-o", `-p ${PGPORT} -h ${PGHOST}`, "start"], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
waitReady();

run(bin("psql.exe"), ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", "postgres", "-tc", `SELECT 1 FROM pg_database WHERE datname='${PGDATABASE}'`], {
  env: { ...process.env, PGSSLMODE: "disable" },
});
const exists = spawnSync(bin("psql.exe"), ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname='${PGDATABASE}'`], {
  encoding: "utf8",
  env: { ...process.env, PGSSLMODE: "disable" },
});
if (!String(exists.stdout).includes("1")) {
  run(bin("createdb.exe"), ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, PGDATABASE]);
}

console.log("Applying bootstrap + lock/job migrations to STAGING only...");
psqlFile(path.join(REPO_ROOT, "scripts/staging/bootstrap.sql"));
psqlFile(path.join(REPO_ROOT, "supabase/migrations/20261008020000_india_post_booking_lock.sql"));
psqlFile(path.join(REPO_ROOT, "supabase/migrations/20261008030000_shipment_recovery_required.sql"));
psqlFile(path.join(REPO_ROOT, "supabase/migrations/20261008031000_india_post_active_booking_job.sql"));

const verify = psql(`
select json_build_object(
  'acquire', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='acquire_india_post_booking_lock'),
  'release', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='release_india_post_booking_lock'),
  'enqueue', exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='enqueue_shipment_booking_job'),
  'recovery_enum', exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='shipment_status' and e.enumlabel='RECOVERY_REQUIRED'),
  'unique_index', exists(select 1 from pg_indexes where indexname='background_jobs_active_shipment_booking_uidx'),
  'anon_execute_acquire', exists(
    select 1 from information_schema.routine_privileges
    where routine_name='acquire_india_post_booking_lock' and grantee='anon' and privilege_type='EXECUTE'
  )
);
`);
console.log("Schema verification:", verify.trim());

const orgOut = spawnSync(bin("psql.exe"), ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-tAc", "insert into public.organizations (name) values ('staging-lock-org') returning id;"], {
  encoding: "utf8",
  env: { ...process.env, PGSSLMODE: "disable" },
});
const org = String(orgOut.stdout).trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
if (!org) throw new Error(`Could not create staging org: ${orgOut.stderr || orgOut.stdout}`);
printTarget({
  environment: "postbus-staging-local",
  target_project: "(none — local isolated cluster)",
  target_database: PGDATABASE,
  host: PGHOST,
  port: PGPORT,
  action: "insert staging connection",
});
spawnSync(bin("psql.exe"), ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-c", `insert into public.india_post_connections (organization_id) values ('${org}') on conflict (organization_id) do nothing;`], {
  encoding: "utf8",
  env: { ...process.env, PGSSLMODE: "disable" },
});
fs.writeFileSync(path.join(STAGING_DIR, "org-id.txt"), org);

const a = spawnSync(bin("psql.exe"), ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-tAc", `select public.acquire_india_post_booking_lock('${org}'::uuid, 45)`], {
  encoding: "utf8",
  env: { ...process.env, PGSSLMODE: "disable" },
});
const b = spawnSync(bin("psql.exe"), ["-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-tAc", `select public.acquire_india_post_booking_lock('${org}'::uuid, 45)`], {
  encoding: "utf8",
  env: { ...process.env, PGSSLMODE: "disable" },
});
const tokens = [a.stdout.trim(), b.stdout.trim()].filter((row) => row && row !== "");
console.log("Sequential two-client acquire (smoke): winners=", tokens.length, "empty=", 2 - tokens.length);
if (tokens.length !== 1) {
  throw new Error("Expected exactly one lock winner on sequential second acquire while held");
}
psql(`select public.release_india_post_booking_lock('${org}'::uuid, '${tokens[0]}'::uuid);`);

fs.writeFileSync(
  path.join(REPO_ROOT, ".env.staging"),
  [
    "STAGING_NAME=postbus-staging-local",
    `STAGING_DATABASE_URL=${DATABASE_URL}`,
    `CEPT_STUB_URL=${CEPT_STUB_URL}`,
    "INDIA_POST_BOOKING_BATCH_SIZE=1",
    "INDIA_POST_BOOKING_CONCURRENCY=2",
    "JOB_RUNNER=database",
    "NODE_ENV=test",
    `STAGING_ORG_ID=${org}`,
    "",
  ].join("\n")
);

console.log(`
STAGING READY
  database: ${DATABASE_URL}
  org: ${org}
  stub: ${CEPT_STUB_URL}  (start with: node scripts/staging/cept-stub.mjs)
  worker A: set STAGING_ORG_ID=${org}&& node scripts/staging/worker.mjs A
  worker B: set STAGING_ORG_ID=${org}&& node scripts/staging/worker.mjs B
  stop: node scripts/staging/stop.mjs

Production project hgacoeoovjxkzfbesmvl was not used.
`);

import { spawnSync } from "node:child_process";
import path from "node:path";
import { PGBIN, PGDATA, PGHOST, PGDATABASE, PGPORT } from "./paths.mjs";
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";

printTarget({
  environment: "postbus-staging-local",
  action: "stop",
  target_project: "(none — local isolated cluster)",
  target_database: PGDATABASE,
  host: PGHOST,
  port: PGPORT,
  pgdata: PGDATA,
});
assertIsolatedTarget("pgdata", PGDATA);
assertIsolatedTarget("host", PGHOST);

const result = spawnSync(path.join(PGBIN, "pg_ctl.exe"), ["-D", PGDATA, "stop", "-m", "fast"], { encoding: "utf8" });
console.log(result.stdout || result.stderr || "stopped");

import { spawnSync } from "node:child_process";
import path from "node:path";
import { PGBIN, PGHOST, PGPORT, PGUSER, PGDATABASE } from "./paths.mjs";
import { assertIsolatedTarget, printTarget } from "./assert-not-production.mjs";

export function psql(sql, extraEnv = {}) {
  printTarget({
    environment: "postbus-staging-local",
    target_project: "(none — local isolated cluster)",
    target_database: PGDATABASE,
    host: PGHOST,
    port: PGPORT,
    user: PGUSER,
  });
  assertIsolatedTarget("database_url", `${PGHOST}/${PGDATABASE}`);
  const result = spawnSync(path.join(PGBIN, "psql.exe"), ["-v", "ON_ERROR_STOP=1", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, PGSSLMODE: "disable", ...extraEnv },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "psql failed");
  }
  return result.stdout;
}

export function psqlFile(filePath) {
  printTarget({
    environment: "postbus-staging-local",
    target_project: "(none — local isolated cluster)",
    target_database: PGDATABASE,
    host: PGHOST,
    port: PGPORT,
    file: filePath,
  });
  assertIsolatedTarget("file", filePath);
  const result = spawnSync(path.join(PGBIN, "psql.exe"), ["-v", "ON_ERROR_STOP=1", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-f", filePath], {
    encoding: "utf8",
    env: { ...process.env, PGSSLMODE: "disable" },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `psql -f ${filePath} failed`);
  }
  return result.stdout;
}

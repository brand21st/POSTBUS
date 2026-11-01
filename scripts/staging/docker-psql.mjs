/**
 * Run SQL against isolated local Docker Postgres (port 54332 / supabase_db_postbuslocal).
 * Never prints connection strings. Refuses production project names.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error("usage: node scripts/staging/docker-psql.mjs <sql-file>");
  process.exit(1);
}
const sql = readFileSync(sqlFile, "utf8");
if (/hgacoeoovjxkzfbesmvl/i.test(sql)) {
  console.error("STOP: SQL mentions production project");
  process.exit(1);
}

const result = spawnSync(
  "wsl",
  [
    "-e",
    "bash",
    "-lc",
    `docker exec -i supabase_db_postbuslocal psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -`,
  ],
  { input: sql, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);

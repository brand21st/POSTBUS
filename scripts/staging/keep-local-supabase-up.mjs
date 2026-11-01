/**
 * Restart isolated local Docker containers if they exit. Staging only.
 */
import { spawnSync } from "node:child_process";

const names = [
  "supabase_db_postbuslocal",
  "supabase_auth_postbuslocal",
  "supabase_rest_postbuslocal",
  "supabase_kong_postbuslocal",
  "supabase_pg_meta_postbuslocal",
  "supabase_inbucket_postbuslocal",
];

function sh(cmd) {
  return spawnSync("wsl", ["-e", "bash", "-lc", cmd], { encoding: "utf8" });
}

console.log("keeping local supabase containers up (isolated)");
for (;;) {
  sh(`docker start ${names.join(" ")} >/dev/null 2>&1 || true`);
  await new Promise((r) => setTimeout(r, 4000));
}

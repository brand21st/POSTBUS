import { spawn } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "./paths.mjs";

const tsx = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");
const worker = path.join(REPO_ROOT, "scripts/staging/booking-worker.ts");
const child = spawn(process.execPath, [tsx, worker], {
  cwd: REPO_ROOT,
  env: { ...process.env, STAGING_ORG_ID: "00000000-0000-0000-0000-000000000001", WORKER_ID: "smoke" },
  stdio: "inherit",
});
setTimeout(() => {
  child.kill("SIGTERM");
  process.exit(1);
}, 8000);
child.on("exit", (code) => process.exit(code ?? 1));

/**
 * Remote apply entry. Always runs the fail-closed gate first.
 * Without user approval this exits 1 and writes nothing.
 */
import { spawnSync } from "node:child_process";

const gate = spawnSync("npx", ["tsx", "scripts/affiliate-staging-gate.mts"], { encoding: "utf8", shell: true });
process.stdout.write(gate.stdout || "");
process.stderr.write(gate.stderr || "");
if (gate.status !== 0) {
  console.error("STAGING_NOT_APPROVED");
  process.exit(gate.status ?? 1);
}
console.error("STOP: gate passed in this process but Phase 3.1 still requires a separate explicit apply instruction naming exact files. No SQL was sent.");
process.exit(2);

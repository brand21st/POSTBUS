/**
 * Production apply entry. Always evaluates the dedicated production gate first.
 * This Phase 3.3 binary never sends SQL, even if the gate would pass.
 */
import { spawnSync } from "node:child_process";

const gate = spawnSync("npx", ["tsx", "scripts/affiliate-production-gate.mts"], { encoding: "utf8", shell: true });
process.stdout.write(gate.stdout || "");
process.stderr.write(gate.stderr || "");
if (gate.status !== 0) {
  console.error("PRODUCTION_NOT_APPROVED");
  process.exit(gate.status ?? 1);
}
console.error("STOP: production gate passed in this process but Phase 3.3 does not send SQL. Separate execution approval is required.");
process.exit(2);

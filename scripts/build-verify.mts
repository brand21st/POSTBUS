/** Local production build into .next-verify so `next dev` can keep `.next`. Does not deploy. */
import { spawn } from "node:child_process";

const child = spawn("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, POSTBUS_NEXT_DIST_DIR: ".next-verify" },
});
child.on("exit", (code) => process.exit(code ?? 1));

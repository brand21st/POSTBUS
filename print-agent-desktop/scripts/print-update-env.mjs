import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(root, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
const version = packageJson.version;

const releaseDir = path.join(desktopRoot, "src-tauri", "target", "release", "bundle", "nsis");
const setupName = `PostBus Print Agent_${version}_x64-setup.exe`;
const setupPath = path.join(releaseDir, setupName);
const sigPath = `${setupPath}.sig`;

if (!fs.existsSync(setupPath)) {
  console.error(`Missing installer: ${setupPath}`);
  console.error("Build with TAURI_SIGNING_PRIVATE_KEY set and createUpdaterArtifacts enabled.");
  process.exit(1);
}
if (!fs.existsSync(sigPath)) {
  console.error(`Missing signature: ${sigPath}`);
  process.exit(1);
}

const signature = fs.readFileSync(sigPath, "utf8").trim();
const url = process.env.PRINT_AGENT_UPDATE_URL?.trim();
if (!url) {
  console.error("Set PRINT_AGENT_UPDATE_URL to the public HTTPS URL of the installer before running this script.");
  process.exit(1);
}

const notes = process.env.PRINT_AGENT_UPDATE_NOTES?.trim() ?? "";

console.log("# Add to Coolify / production env, then redeploy the web app.");
console.log(`PRINT_AGENT_UPDATE_VERSION=${version}`);
console.log(`PRINT_AGENT_UPDATE_URL=${url}`);
console.log(`PRINT_AGENT_UPDATE_SIGNATURE=${signature}`);
if (notes) console.log(`PRINT_AGENT_UPDATE_NOTES=${notes}`);

/**
 * Fills gitignored .env.shopify-local INTEGRATION_ENCRYPTION_KEY if empty.
 * Never prints the key. Does not touch production or hosted SQL.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = ".env.shopify-local";
const FALLBACK = "dev-only-change-me-32-bytes-min!!";

if (!existsSync(file)) {
  console.error("STOP: .env.shopify-local is missing.");
  process.exit(1);
}

const text = readFileSync(file, "utf8");
const match = text.match(/^INTEGRATION_ENCRYPTION_KEY=(.*)$/m);
const current = (match?.[1] ?? "").trim();
if (current.length >= 32 && current !== FALLBACK) {
  console.log(JSON.stringify({ encryptionKeyAction: "kept", length: current.length, write: false }));
  process.exit(0);
}

const key = randomBytes(32).toString("hex");
const next = match
  ? text.replace(/^INTEGRATION_ENCRYPTION_KEY=.*$/m, `INTEGRATION_ENCRYPTION_KEY=${key}`)
  : `${text.replace(/\s*$/, "")}\nINTEGRATION_ENCRYPTION_KEY=${key}\n`;
writeFileSync(file, next);
console.log(JSON.stringify({ encryptionKeyAction: "generated", length: key.length, write: "overlay-only" }));

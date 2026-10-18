import { readFile } from "fs/promises";
import path from "path";

const FILES: Record<string, string> = {
  "openapi.yaml": "openapi.yaml",
  "POSTBUS_API_REFERENCE.md": "POSTBUS_API_REFERENCE.md",
  "POSTBUS_AI_INTEGRATION_GUIDE.md": "POSTBUS_AI_INTEGRATION_GUIDE.md",
  "GOOGLE_APPS_SCRIPT_EXAMPLE.md": "GOOGLE_APPS_SCRIPT_EXAMPLE.md",
};

export function merchantDocNames() {
  return Object.keys(FILES);
}

export async function readMerchantDoc(name: string) {
  const file = FILES[name];
  if (!file) return null;
  const full = path.join(process.cwd(), "docs", "merchant-api", file);
  return readFile(full, "utf8");
}

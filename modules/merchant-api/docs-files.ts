import { readFile } from "fs/promises";
import path from "path";
import { merchantOpenApiDocument, merchantOpenApiYaml } from "@/modules/merchant-api/openapi-document";

const FILES: Record<string, string> = {
  "openapi.yaml": "openapi.yaml",
  "openapi.json": "generated",
  "POSTBUS_API_REFERENCE.md": "POSTBUS_API_REFERENCE.md",
  "POSTBUS_AI_INTEGRATION_GUIDE.md": "POSTBUS_AI_INTEGRATION_GUIDE.md",
  "GOOGLE_APPS_SCRIPT_EXAMPLE.md": "GOOGLE_APPS_SCRIPT_EXAMPLE.md",
};

export function merchantDocNames() {
  return Object.keys(FILES);
}

export async function readMerchantDoc(name: string) {
  if (name === "openapi.json") return JSON.stringify(merchantOpenApiDocument(), null, 2);
  if (name === "openapi.yaml") {
    const full = path.join(process.cwd(), "docs", "merchant-api", "openapi.yaml");
    try {
      return await readFile(full, "utf8");
    } catch {
      return merchantOpenApiYaml();
    }
  }
  const file = FILES[name];
  if (!file || file === "generated") return null;
  const full = path.join(process.cwd(), "docs", "merchant-api", file);
  return readFile(full, "utf8");
}

import { readFileSync } from "node:fs";
import path from "node:path";

const EMBEDDED_SECRET_LINE = 'var EMBEDDED_CRM_SECRET = ""; // POSTBUS_EMBEDDED_SECRET';

export function sheetsCrmScriptSource() {
  return readFileSync(path.join(process.cwd(), "modules", "sheets-crm", "apps-script", "Code.gs"), "utf8");
}

export function renderSheetsCrmScript(source: string, secret: string) {
  if (!source.includes(EMBEDDED_SECRET_LINE)) {
    throw new Error("Apps Script is missing the embedded secret placeholder.");
  }
  return source.replace(EMBEDDED_SECRET_LINE, `var EMBEDDED_CRM_SECRET = ${JSON.stringify(secret)}; // POSTBUS_EMBEDDED_SECRET`);
}

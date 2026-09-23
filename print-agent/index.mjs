import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return "";
  return process.argv[index + 1] || "";
}

const baseUrl = (argValue("--url") || process.env.POSTBUS_URL || "").replace(/\/$/, "");
const token = argValue("--token") || process.env.POSTBUS_PRINT_TOKEN || "";

if (!baseUrl || !token) {
  console.error("Usage: node index.mjs --url https://your-postbus-domain --token pb_print_...");
  process.exit(1);
}

async function listPrintersWindows() {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-Printer | Select-Object -ExpandProperty Name"],
      { windowsHide: true }
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("close", () => {
      resolve(
        out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      );
    });
    child.on("error", () => resolve([]));
  });
}

async function listPrinters() {
  try {
    const { getPrinters } = require("pdf-to-printer");
    const printers = await getPrinters();
    const names = (printers ?? []).map((item) => item.name || item.deviceId).filter(Boolean);
    if (names.length) return names;
  } catch {
    // Fall through to OS discovery.
  }
  if (process.platform === "win32") return listPrintersWindows();
  return [];
}

async function printPdf(filePath, options) {
  try {
    const { print } = require("pdf-to-printer");
    await print(filePath, {
      printer: options.printer,
      copies: options.copies,
      paperSize: options.paperSize,
      orientation: options.orientation,
      scale: "noscale",
      silent: true,
    });
    return;
  } catch (error) {
    if (process.platform !== "win32") throw error;
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Start-Process -FilePath ${JSON.stringify(filePath)} -Verb PrintTo -ArgumentList ${JSON.stringify(options.printer)} -Wait -WindowStyle Hidden`,
      ],
      { windowsHide: true }
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Windows could not send the PDF to the selected printer."));
    });
    child.on("error", reject);
  });
}

async function api(pathname, init = {}) {
  const response = await fetch(`${baseUrl}/api/v1/${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (pathname.endsWith("/pdf")) {
    if (!response.ok) {
      throw new Error(`PDF download failed (${response.status}).`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || `Request failed (${response.status}).`);
  }
  return payload.data ?? payload;
}

async function tick() {
  const printers = await listPrinters();
  await api("print-agent/heartbeat", {
    method: "POST",
    body: JSON.stringify({ printers }),
  });

  const claimed = await api("print-agent/jobs/claim", { method: "POST" });
  const job = claimed?.job;
  if (!job?.id) return;

  const printer = job.printerName || job.printer_name;
  try {
    if (!printer || !printers.includes(printer)) {
      throw new Error("Invalid printer. Choose a connected label printer in Automation.");
    }
    const bytes = await api(`print-jobs/${job.id}/pdf`);
    const folder = await mkdtemp(path.join(tmpdir(), "postbus-label-"));
    const filePath = path.join(folder, `${job.id}.pdf`);
    await writeFile(filePath, bytes);
    await printPdf(filePath, {
      printer,
      copies: Number(claimed.copies) || 1,
      paperSize: claimed.paperSize || claimed.paper_size || "A6",
      orientation: claimed.orientation || "portrait",
    });
    await api(`print-jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "PRINTED" }),
    });
    console.log(`Printed ${job.id} on ${printer}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Print failed.";
    const retryable = /busy|offline|unavailable|timeout|not connected|invalid printer/i.test(message);
    await api(`print-jobs/${job.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: retryable ? "PENDING" : "FAILED",
        errorMessage: retryable
          ? "Printer unavailable. Label will print when the printer reconnects."
          : message,
      }),
    }).catch(() => {});
    console.error(`Print job ${job.id} failed: ${message}`);
  }
}

console.log(`PostBus print agent connected to ${baseUrl}`);
setInterval(() => {
  tick().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
  });
}, 2000);
tick().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
});

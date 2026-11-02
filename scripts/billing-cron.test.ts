import { createServer } from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts/billing-cron.mjs");

function runScript(env: NodeJS.ProcessEnv, extra: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, extra.concat(script), {
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function listen(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

describe("scripts/billing-cron.mjs", () => {
  it("exits when CRON_SECRET is missing", async () => {
    const result = await runScript({ CRON_SECRET: "", PORT: "3000" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("CRON_SECRET is not set");
    expect(result.stdout + result.stderr).not.toMatch(/Bearer /i);
  });

  it("exits on HTTP 401 and does not print the secret", async () => {
    const server = await listen((_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ success: false, message: "Invalid cron secret." }));
    });
    try {
      const result = await runScript({
        CRON_SECRET: "expected-secret-value",
        JOB_RUNNER_URL: server.url,
        PORT: "3000",
      });
      expect(result.code).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("expected-secret-value");
    } finally {
      await server.close();
    }
  });

  it("exits on HTTP 500 so the scheduler can retry later", async () => {
    const server = await listen((_req, res) => {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, message: "Billing sweep failed." }));
    });
    try {
      const result = await runScript({
        CRON_SECRET: "secret",
        JOB_RUNNER_URL: server.url,
        PORT: "3000",
      });
      expect(result.code).toBe(1);
    } finally {
      await server.close();
    }
  });

  it("exits zero only after a successful JSON payload", async () => {
    const server = await listen((req, res) => {
      expect(req.method).toBe("POST");
      expect(req.headers.authorization).toBe("Bearer secret");
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, data: { expired: 0, skipped: 1, failures: 0 } }));
    });
    try {
      const result = await runScript({
        CRON_SECRET: "secret",
        JOB_RUNNER_URL: server.url,
        PORT: "3000",
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('"success":true');
      expect(result.stdout).not.toContain("secret");
    } finally {
      await server.close();
    }
  });

  it("aborts after the configured timeout", async () => {
    const server = await listen(() => undefined);
    try {
      const result = await runScript({
        CRON_SECRET: "secret",
        JOB_RUNNER_URL: server.url,
        PORT: "3000",
        BILLING_CRON_TIMEOUT_MS: "50",
      });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("timed out");
    } finally {
      await server.close();
    }
  });
});

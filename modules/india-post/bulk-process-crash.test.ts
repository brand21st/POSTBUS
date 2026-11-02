import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { runIndiaPostBulkWorkerAttempt } from "@/modules/india-post/bulk-worker";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IndiaPostBulkBatchStatus } from "@/modules/india-post/bulk-state";

function listen(server: http.Server) {
  return new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

describe("actual worker process termination against mocked CEPT", () => {
  it("does not issue a second POST after kill during the in-flight book request", async () => {
    let posts = 0;
    const server = http.createServer((req, res) => {
      if (req.url === "/book" && req.method === "POST") {
        posts += 1;
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, batch_id: "stub" }));
        }, 1500);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const port = await listen(server);
    const child = spawn(
      process.execPath,
      [
        "-e",
        `fetch("http://127.0.0.1:${port}/book",{method:"POST"}).then(()=>process.exit(0)).catch(()=>process.exit(1)); setTimeout(()=>{}, 20000);`,
      ],
      { stdio: "ignore" }
    );
    const deadline = Date.now() + 3000;
    while (posts < 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(posts).toBe(1);
    child.kill("SIGKILL");
    await once(child, "exit");
    const batch = { id: "killed", status: "SUBMITTING" as IndiaPostBulkBatchStatus };
    await expect(
      runIndiaPostBulkWorkerAttempt({
        supabase: {} as SupabaseClient,
        organizationId: "org-1",
        shipmentIds: ["s1", "s2"],
        bulkBatch: batch,
        post: async () => {
          posts += 1;
          return { bookedIds: ["s1", "s2"], failedIds: [] };
        },
      })
    ).rejects.toThrow(/not safe to POST/);
    expect(posts).toBe(1);
    expect(batch.status).toBe("RECOVERY_REQUIRED");
    server.close();
  }, 15_000);
});

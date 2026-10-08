import { spawn } from "node:child_process";
import path from "node:path";
import { PGBIN, PGDATABASE, PGHOST, PGPORT, PGUSER } from "./paths.mjs";
import { printSafetyGate } from "./gate.mjs";

let gated = false;
function runPsql(sql) {
  if (!gated) {
    printSafetyGate({ ACTION: "psql" });
    gated = true;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(PGBIN, "psql.exe"),
      ["-v", "ON_ERROR_STOP=1", "-t", "-A", "-h", PGHOST, "-p", PGPORT, "-U", PGUSER, "-d", PGDATABASE, "-c", sql],
      { env: { ...process.env, PGSSLMODE: "disable" }, stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => {
      out += c;
    });
    child.stderr.on("data", (c) => {
      err += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || out || "psql failed"));
      else {
        const cleaned = out
          .trim()
          .split(/\r?\n/)
          .filter((line) => !/^(UPDATE|INSERT|DELETE)\s+\d+$/i.test(line.trim()))
          .join("\n")
          .trim();
        resolve(cleaned);
      }
    });
  });
}

export function createStagingRpc(mode = "ok") {
  if (mode === "missing") {
    return {
      rpc: async () => ({ data: null, error: { code: "42883", message: "function acquire_india_post_booking_lock does not exist" } }),
    };
  }
  if (mode === "hang") {
    return {
      rpc: () => new Promise(() => undefined),
    };
  }
  return {
    async rpc(name, args = {}) {
      try {
        if (name === "acquire_india_post_booking_lock") {
          const data = await runPsql(
            `select coalesce(public.acquire_india_post_booking_lock('${args.p_organization_id}'::uuid, ${Number(args.p_ttl_seconds ?? 45)})::text, '')`
          );
          return { data: data || null, error: null };
        }
        if (name === "release_india_post_booking_lock") {
          await runPsql(
            `select public.release_india_post_booking_lock('${args.p_organization_id}'::uuid, '${args.p_token}'::uuid)`
          );
          return { data: null, error: null };
        }
        if (name === "enqueue_shipment_booking_job") {
          const data = await runPsql(
            `select id::text from public.enqueue_shipment_booking_job('${args.p_organization_id}'::uuid, '${args.p_entity_id}'::uuid, null, '{}'::jsonb)`
          );
          return { data: { id: data }, error: null };
        }
        return { data: null, error: { message: `unknown rpc ${name}` } };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : "rpc failed" } };
      }
    },
  };
}

export { runPsql };

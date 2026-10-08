import http from "node:http";
import { CEPT_STUB_URL, STUB_PORT } from "./paths.mjs";
import { printSafetyGate } from "./gate.mjs";

printSafetyGate({ PROCESS: "cept-stub" });

const state = {
  current_active_requests: 0,
  maximum_active_requests: 0,
  requests: [],
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === "/health") return json(200, { ok: true, provider_mode: "STUB" });
  if (url.pathname === "/stats") return json(200, state);
  if (url.pathname === "/reset" && req.method === "POST") {
    state.current_active_requests = 0;
    state.maximum_active_requests = 0;
    state.requests = [];
    return json(200, { ok: true });
  }
  if (url.pathname === "/track") {
    const mode = url.searchParams.get("mode") || "empty";
    const barcode = url.searchParams.get("barcode") || "";
    if (mode === "unavailable") return json(503, { message: "tracking unavailable" });
    if (mode === "found") return json(200, { data: [{ booking_details: { article_number: barcode } }] });
    if (mode === "not_booked") return json(200, { message: "Article not booked" });
    return json(200, { data: [] });
  }
  if (req.method !== "POST" || url.pathname !== "/book") {
    res.writeHead(404);
    return res.end("not found");
  }

  const body = await readBody(req);
  const mode = url.searchParams.get("mode") || body.mode || "success";
  const delayMs = Number(url.searchParams.get("delay") ?? body.delayMs ?? 3000);
  const request = {
    request_id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    worker_pid: Number(req.headers["x-worker-pid"] || 0),
    worker: req.headers["x-worker-id"] || "",
    organization_id: body.organization_id || req.headers["x-organization-id"] || "",
    shipment_id: body.shipment_id || "",
    job_id: body.job_id || "",
    barcode: body.barcode || "",
    attempt: body.attempt || 1,
    start_time: new Date().toISOString(),
    start_ms: Date.now(),
  };
  state.current_active_requests += 1;
  state.maximum_active_requests = Math.max(state.maximum_active_requests, state.current_active_requests);
  request.mode = mode;
  state.requests.push(request);

  if (mode === "hang") {
    request.hung = true;
    return;
  }

  await new Promise((r) => setTimeout(r, delayMs));
  state.current_active_requests = Math.max(0, state.current_active_requests - 1);
  request.end_time = new Date().toISOString();
  request.end_ms = Date.now();
  request.active_requests = state.current_active_requests;

  if (mode === "temp409") {
    return json(409, { message: "Internal server error during processing", success: false });
  }
  if (mode === "unknown409") {
    return json(409, { message: "some unknown response", success: false });
  }
  if (mode === "duplicate") {
    return json(409, { message: "Duplicate article: Already booked today or yesterday", success: false });
  }
  json(200, { success: true, stub: true, request_id: request.request_id });
});

server.listen(Number(STUB_PORT), "127.0.0.1", () => {
  console.log(`CEPT stub STUB-ONLY ${CEPT_STUB_URL}`);
});

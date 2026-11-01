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

  if (url.pathname === "/health") {
    return json(200, { ok: true, provider_mode: "STUB", login: true, bulk: true });
  }
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
  const isLogin =
    req.method === "POST" &&
    (url.pathname === "/beextcustomer/v1/access/login" ||
      url.pathname === "/v1/access/login" ||
      url.pathname === "/access/login");
  if (isLogin) {
    const body = await readBody(req);
    const username = String(body.username ?? "").toLowerCase();
    const mode = (url.searchParams.get("mode") || username).toLowerCase();
    if (mode.includes("timeout") || mode.includes("hang")) {
      return;
    }
    if (mode.includes("429") || mode.includes("rate")) {
      return json(429, { success: false, message: "rate limited" });
    }
    if (mode.includes("500") || mode.includes("server")) {
      return json(500, { success: false, message: "internal error" });
    }
    if (mode.includes("401") || mode.includes("unauthorized")) {
      return json(401, { success: false, message: "Unauthorized" });
    }
    if (mode.includes("validation") || mode.includes("customer id")) {
      return json(400, { success: false, message: "customer id is required" });
    }
    if (mode.includes("fail") || mode.includes("auth") || mode.includes("invalid")) {
      return json(400, { success: false, message: "India Post authentication failed." });
    }
    return json(200, {
      success: true,
      status_code: 200,
      data: {
        access_token: "LOCAL_TEST_TOKEN",
        refresh_token: "LOCAL_REFRESH",
        id_token: "LOCAL_ID",
        expires_in: 900,
        refresh_expires_in: 3600,
      },
    });
  }

  const isBulk =
    req.method === "POST" &&
    (url.pathname === "/beextcustomer/v1/tracking/bulk" ||
      url.pathname === "/v1/tracking/bulk" ||
      url.pathname === "/tracking/bulk");
  if (isBulk) {
    const body = await readBody(req);
    const mode = (url.searchParams.get("mode") || "").toLowerCase();
    const auth = String(req.headers.authorization || "");
    if (mode === "401" || (mode === "require-token" && !auth.includes("LOCAL_TEST_TOKEN"))) {
      return json(401, { success: false, message: "Unauthorized" });
    }
    if (mode === "403") return json(403, { success: false, message: "You are not authorized to access this API" });
    if (mode === "400") return json(400, { success: false, message: "article not found" });
    if (mode === "404") return json(404, { success: false, message: "not found" });
    if (mode === "429") return json(429, { success: false, message: "rate limited" });
    if (mode === "500") return json(500, { success: false, message: "unavailable" });
    if (mode === "timeout") return;
    const bulk = Array.isArray(body.bulk) ? body.bulk.map((row) => String(row)) : [];
    if (mode === "empty") return json(200, { success: true, data: [] });
    const articles = bulk.map((barcode, index) => {
      if (mode === "partial" && index > 0) return null;
      const delivered = mode === "delivered" || /DELIV/i.test(barcode);
      return {
        article_number: barcode,
        booking_details: { article_number: barcode },
        tracking_details:
          mode === "unknown"
            ? []
            : [
                {
                  date: "2026-10-17",
                  time: "10:00:00",
                  office: "TEST PO",
                  event: delivered ? "Item Delivered" : "Item Bagged",
                  event_code: delivered ? "ITEM_DELIVERED" : "ITEM_BAGGED",
                },
              ],
        del_status: delivered ? { del_status: "delivered" } : undefined,
      };
    });
    return json(200, { success: true, data: articles.filter(Boolean) });
  }

  if (req.method === "GET" && url.pathname.includes("pincode-search")) {
    const pin = url.searchParams.get("pincode") || "673001";
    return json(200, {
      success: true,
      data: [
        {
          office_id: "22660454",
          office_name: "Kozhikode HO",
          office_type_code: "HO",
          delivery_office_flag: true,
          pincode: pin,
        },
      ],
    });
  }

  if (req.method === "POST" && url.pathname.includes("label/create/domestic")) {
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    res.writeHead(200, { "content-type": "application/pdf", "content-length": String(pdf.length) });
    return res.end(pdf);
  }

  if (req.method === "POST" && url.pathname.includes("process-articles")) {
    const body = await readBody(req);
    const articles = Array.isArray(body.articles) ? body.articles : [];
    state.requests.push({
      path: url.pathname,
      barcodes: articles.map((row) => row?.barcode_no || row?.barcode || null),
      at: new Date().toISOString(),
    });
    return json(200, {
      success: true,
      valid_articles: articles.map((row) => ({
        barcode_no: row?.barcode_no || row?.barcode,
        article_number: row?.barcode_no || row?.barcode,
        calculated_tariff: 45,
      })),
      error_articles: [],
    });
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

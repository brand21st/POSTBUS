import { createDecipheriv, scryptSync } from "crypto";
import { readFileSync, existsSync } from "fs";

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const PROD = "https://app.indiapost.gov.in/beextcustomer";
const UAT = "https://test.cept.gov.in/beextcustomer";

function decryptSecret(payload, secret) {
  const [iv, tag, data] = String(payload || "").split(".");
  if (!iv || !tag || !data) throw new Error("Invalid encrypted payload.");
  const key = scryptSync(secret, "postbus-integrations", 32);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

function record(name, ok, detail, ms) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${ms != null ? ms + "ms  " : ""}${String(detail).slice(0, 280)}`);
}

async function timed(fn) {
  const started = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - started };
}

async function req(base, path, init = {}) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, init);
  const buffer = Buffer.from(await response.arrayBuffer());
  const ms = Date.now() - started;
  const isPdf = buffer.length >= 4 && buffer.subarray(0, 4).toString() === "%PDF";
  let json = null;
  let text = "";
  if (!isPdf) {
    text = buffer.toString("utf8");
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { response, json, text, isPdf, bytes: buffer.length, ms };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encKey = process.env.INTEGRATION_ENCRYPTION_KEY || "dev-only-change-me-32-bytes-min!!";
  if (!supabaseUrl || !serviceKey || !encKey) {
    throw new Error("Missing SUPABASE or INTEGRATION_ENCRYPTION_KEY in container env.");
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };
  const connRes = await fetch(
    `${supabaseUrl}/rest/v1/india_post_connections?status=eq.CONNECTED&environment=eq.PRODUCTION&bulk_customer_id=eq.1788590988&select=*`,
    { headers }
  );
  const rows = await connRes.json();
  const conn = Array.isArray(rows) ? rows[0] : null;
  if (!conn) throw new Error("No production India Post connection for the live merchant.");

  const username = decryptSecret(conn.encrypted_username, encKey);
  const password = decryptSecret(conn.encrypted_password, encKey);
  record("merchant credentials loaded", Boolean(username && password), `user_len=${username.length} customer_id_len=${String(conn.bulk_customer_id).length}`);

  const login = await req(PROD, "/v1/access/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const token = login.json?.data?.access_token;
  record(
    "PROD POST /v1/access/login",
    Boolean(login.response.ok && token),
    `HTTP ${login.response.status} expires_in=${login.json?.data?.expires_in ?? "n/a"}`,
    login.ms
  );
  if (!token) process.exit(2);

  const auth = { Authorization: `Bearer ${token}` };
  const jsonAuth = { ...auth, "Content-Type": "application/json" };

  const pin = await req(PROD, "/v1/pincode-search?pincode=682311&office-type=post", { headers: auth });
  const offices = Array.isArray(pin.json?.data) ? pin.json.data : Array.isArray(pin.json) ? pin.json : [];
  record("PROD GET /v1/pincode-search", pin.response.ok && offices.length > 0, `HTTP ${pin.response.status} offices=${offices.length}`, pin.ms);

  const tariff = await req(
    PROD,
    "/v1/speed-post/tariffs?product-code=SP&weight=500&source-pincode=682311&destination-pincode=110001",
    { headers: auth }
  );
  record("PROD GET /v1/speed-post/tariffs", tariff.response.ok, `HTTP ${tariff.response.status} ${Object.keys(tariff.json || {}).slice(0, 6).join(",")}`, tariff.ms);

  const shipRes = await fetch(
    `${supabaseUrl}/rest/v1/shipments?organization_id=eq.${conn.organization_id}&barcode=not.is.null&booked_at=not.is.null&select=barcode,status&order=booked_at.desc&limit=1`,
    { headers }
  );
  const ships = await shipRes.json();
  const barcode = ships?.[0]?.barcode;
  if (barcode) {
    const track = await req(PROD, "/v1/tracking/bulk", {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify({ bulk: [barcode] }),
    });
    record(
      "PROD POST /v1/tracking/bulk",
      track.response.ok,
      `HTTP ${track.response.status} rows=${track.json?.data?.length ?? 0} body=${(track.text || "").slice(0, 120)}`,
      track.ms
    );
  }

  const eventBodies = [
    { Cust_Id: String(conn.bulk_customer_id), Event_Code: "IB", Event_Date: "01032026" },
    { cust_id: String(conn.bulk_customer_id), event_code: "IB", event_date: "2026-10-01" },
  ];
  for (const path of ["/v1/event/download", "/event/download"]) {
    const get = await req(PROD, path, { headers: auth });
    record(`PROD GET ${path}`, get.response.status === 200 && get.bytes > 0, `HTTP ${get.response.status} bytes=${get.bytes}`, get.ms);
    for (const [index, body] of eventBodies.entries()) {
      const post = await req(PROD, path, { method: "POST", headers: jsonAuth, body: JSON.stringify(body) });
      record(
        `PROD POST ${path} body${index + 1}`,
        post.response.status === 200 && post.bytes > 0,
        `HTTP ${post.response.status} bytes=${post.bytes} ${post.text.slice(0, 80)}`,
        post.ms
      );
    }
  }

  try {
    const label = await req(PROD, "/v1/label/create/domestic", {
      method: "POST",
      headers: jsonAuth,
      body: JSON.stringify([
        {
          customer_id: Number(conn.bulk_customer_id),
          destination_pin: "110001",
          booking_datetime: "01-10-2026 03:40:00",
          channel_type: "E",
          user_type: "R",
          user_id: Number(conn.bulk_customer_id),
          barcode_no: barcode || "CL000000000IN",
          service_type: "BUSINESS_PARCEL",
          booking_type: "COMMERCIAL",
          article_length: "20",
          article_breadth: "15",
          article_height: "10",
          charged_weight: 500,
          physical_weight: 500,
          volumetric_weight: 0,
          insurance_flag: false,
          insurance_value: 0,
          recipient_name: "Test Recipient",
          recipient_addressl1: "Address line",
          recipient_city: "DELHI",
          recipient_pin: "110001",
          recipient_state: "DELHI",
          sender_name: "Merchant",
          sender_addressl1: "Kolenchery",
          sender_city: "Ernakulam",
          sender_pin: "682311",
          sender_state: "Kerala",
          transmission_mode: "S",
          payment_mode: "CO",
          routing_data: "682311 - 110001",
          booking_office_name: "Kolenchery SO",
          booking_office_pin: "682311",
          size: "A6",
          payment_status: "PC",
          identifier: "Domestic",
          priority: false,
          registered_flag: false,
        },
      ]),
    });
    record("PROD POST /v1/label/create/domestic", label.response.ok && (label.isPdf || label.bytes > 500), `HTTP ${label.response.status} pdf=${label.isPdf} bytes=${label.bytes}`, label.ms);
  } catch (error) {
    record("PROD POST /v1/label/create/domestic", false, error instanceof Error ? error.message : String(error));
  }

  console.log(
    JSON.stringify({
      host: "app.indiapost.gov.in",
      login_ms: login.ms,
      pincode_ms: pin.ms,
      tariff_ms: tariff.ms,
      label_ms: label.ms,
    })
  );
}

main().catch((error) => {
  console.error("PROBE_ERROR", error instanceof Error ? error.message : error);
  process.exit(1);
});

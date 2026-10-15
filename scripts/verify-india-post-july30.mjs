/**
 * Live CEPT UAT probe against the 30.07.2026 approach document.
 * Uses the documented sample UAT login from that PDF. Does not print tokens.
 */
const BASE = "https://test.cept.gov.in/beextcustomer";
const USERNAME = process.env.INDIA_POST_UAT_USERNAME || "9999999999";
const PASSWORD = process.env.INDIA_POST_UAT_PASSWORD || "Dop@1234";
const CUSTOMER_ID = "3000064781";

const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail: String(detail).slice(0, 400) });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function summarizeJson(value) {
  if (value == null) return "empty";
  if (typeof value === "string") return value.slice(0, 180);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value).slice(0, 12).join(",");
    return `object{${keys}}`;
  }
  return String(value);
}

async function request(path, init = {}) {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init.headers,
  });
  const elapsed = Date.now() - started;
  const contentType = response.headers.get("content-type") || "";
  const buffer = Buffer.from(await response.arrayBuffer());
  const isPdf = buffer.length >= 5 && buffer.subarray(0, 4).toString() === "%PDF";
  let json = null;
  let text = "";
  if (isPdf) {
    return { response, elapsed, contentType, isPdf, bytes: buffer.length, json: null, text: "" };
  }
  text = buffer.toString("utf8");
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, elapsed, contentType, isPdf: false, bytes: buffer.length, json, text };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function officesFromPincodeBody(json, text) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* ignore */
  }
  return [];
}

async function main() {
  const login = await request("/v1/access/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const token = login.json?.data?.access_token;
  const expires = login.json?.data?.expires_in;
  record(
    "POST /v1/access/login",
    Boolean(login.response.ok && login.json?.success && token),
    `HTTP ${login.response.status} ${login.elapsed}ms expires_in=${expires ?? "n/a"} has_refresh=${Boolean(login.json?.data?.refresh_token)}`
  );
  if (!token) {
    record("ABORT", false, "No access token; remaining CEPT calls skipped.");
    printSummary();
    process.exit(1);
  }

  const pin = await request("/v1/pincode-search?pincode=570001&office-type=post", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const offices = officesFromPincodeBody(pin.json, pin.text);
  const delivery = offices.find((office) => office.delivery_office_flag && String(office.office_type_code).toUpperCase() !== "BPO");
  record(
    "GET /v1/pincode-search",
    pin.response.ok && offices.length > 0,
    `HTTP ${pin.response.status} ${pin.elapsed}ms body=${summarizeJson(pin.json)} offices=${offices.length} delivery_office=${delivery?.office_id || "none"}`
  );

  const tariff = await request(
    "/v1/speed-post/tariffs?product-code=SP&weight=250&source-pincode=400001&destination-pincode=110001&length=30&width=21&height=0.5",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  record(
    "GET /v1/speed-post/tariffs",
    tariff.response.ok && tariff.json != null,
    `HTTP ${tariff.response.status} ${tariff.elapsed}ms ${summarizeJson(tariff.json)}`
  );

  const track = await request("/v1/tracking/bulk", {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify({ bulk: ["RK775227016IN"] }),
  });
  record(
    "POST /v1/tracking/bulk",
    track.response.ok,
    `HTTP ${track.response.status} ${track.elapsed}ms ${summarizeJson(track.json)}`
  );

  const events = await request("/v1/event/download", {
    headers: { Authorization: `Bearer ${token}` },
  });
  record(
    "GET /v1/event/download",
    events.response.status >= 200 && events.response.status < 300 && events.bytes > 0,
    `HTTP ${events.response.status} ${events.elapsed}ms bytes=${events.bytes} ${summarizeJson(events.json) || events.text.slice(0, 80)}`
  );

  const officeId = Number(delivery?.office_id) || 21360043;
  const article = {
    bulk_customer_id: CUSTOMER_ID,
    contract_id: "41585456",
    barcode_no: "ET214330016IN",
    pickup_or_dropoff: "DROPOFF",
    pickup_dropoff_office_id: officeId,
    article_type: "SP",
    physical_weight: 250,
    shape_of_article: "DOC",
    length: 20,
    breadth_diameter: 15,
    height: 1,
    priority_flag: "",
    delivery_instruction: "",
    delivery_slot: "",
    instruction_rts: "",
    sender_name: "PostBus UAT",
    sender_company: "PostBus UAT",
    sender_add_line_1: "Mysuru Head Office",
    sender_add_line_2: "",
    sender_add_line_3: "",
    sender_city: "MYSURU",
    sender_state: "Karnataka",
    sender_pincode: "570001",
    sender_emailid: "",
    sender_alt_contact: "",
    sender_kyc: "",
    sender_tax_reference: "",
    receiver_name: "Saurabh Shukla",
    receiver_company: "Saurabh Shukla",
    receiver_add_line_1: "NEW DELHI GPO",
    receiver_add_line_2: "",
    receiver_add_line_3: "",
    receiver_city: "CENTRAL DELHI",
    receiver_state: "DELHI",
    receiver_pincode: "110001",
    receiver_emailid: "",
    receiver_alt_contact: "",
    receiver_kyc: "",
    receiver_tax_reference: "",
    alt_address_flag: "FALSE",
    pickup_address_flag: "FALSE",
    drop_off_pincode: "570001",
    sender_mobile_no: "9234567890",
    receiver_mobile_no: "9234567890",
    prepayment_code: "",
    value_of_prepayment: 0,
    codr_cod: "",
    value_for_codr_cod: "",
    insurance_type: "",
    value_of_insurance: 0,
    ack: "FALSE",
    reg: "FALSE",
    otp: "FALSE",
    bulk_reference: "postbus-july30-verify",
    pickup_address_id: "",
    pickup_addressee_name: "",
    pickup_company_name: "",
    pickup_address_line1: "",
    pickup_address_line2: "",
    pickup_address_line3: "",
    pickup_city: "",
    pickup_state: "",
    pickup_pincode: "",
    pickup_email_id: "",
    pickup_alt_contact_no: "",
    pickup_mobile_no: "",
    pickup_schedule_slot: "",
    pickup_schedule_date: "",
    alt_addressee_name: "",
    alt_company_name: "",
    alt_address_line1: "",
    alt_address_line2: "",
    alt_address_line3: "",
    alt_city: "",
    alt_state: "",
    alt_pincode: "",
    alt_email_id: "",
    alt_contact_no: "",
    alt_alternate_mobile_no: "",
  };

  const book = await request(`/process-articles/${CUSTOMER_ID}`, {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify({ articles: [article] }),
  });
  const bookOk = Boolean(book.response.ok && book.json?.success !== false);
  record(
    "POST /process-articles (SP article_type)",
    bookOk,
    `HTTP ${book.response.status} ${book.elapsed}ms ${summarizeJson(book.json)} msg=${book.json?.message || book.json?.errors?.[0]?.msg || book.json?.error_articles?.[0]?.errors?.[0] || ""}`
  );

  if (!bookOk) {
    const inland = { ...article, article_type: "SP_INLAND_DOC", barcode_no: "ET214330024IN" };
    const book2 = await request(`/process-articles/${CUSTOMER_ID}`, {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify({ articles: [inland] }),
    });
    record(
      "POST /process-articles (SP_INLAND_DOC article_type)",
      Boolean(book2.response.ok && book2.json?.success !== false),
      `HTTP ${book2.response.status} ${book2.elapsed}ms ${summarizeJson(book2.json)} msg=${book2.json?.message || book2.json?.errors?.[0]?.msg || book2.json?.error_articles?.[0]?.errors?.[0] || ""}`
    );
  }

  const label = await request("/v1/label/create/domestic", {
    method: "POST",
    headers: bearer(token),
    body: JSON.stringify([
      {
        customer_id: Number(CUSTOMER_ID),
        destination_pin: "110001",
        booking_datetime: "01-10-2026 03:30:00",
        channel_type: "E",
        user_type: "R",
        user_id: Number(CUSTOMER_ID),
        barcode_no: "ET214330016IN",
        service_type: "SP",
        booking_type: "COMMERCIAL",
        article_length: "20",
        article_breadth: "15",
        article_height: "1",
        charged_weight: 250,
        physical_weight: 250,
        volumetric_weight: 0,
        insurance_flag: false,
        insurance_value: 0,
        recipient_name: "Saurabh Shukla",
        recipient_mobile: "9234567890",
        recipient_addressl1: "NEW DELHI GPO",
        recipient_city: "DELHI",
        recipient_pin: "110001",
        recipient_state: "DELHI",
        sender_name: "PostBus UAT",
        sender_mobile: "9234567890",
        sender_addressl1: "Mysuru Head Office",
        sender_city: "MYSURU",
        sender_pin: "570001",
        sender_state: "Karnataka",
        transmission_mode: "A",
        payment_mode: "CO",
        routing_data: "570001 - 110001",
        booking_office_name: delivery?.office_name || "Mysuru H.O",
        booking_office_pin: "570001",
        size: "A6",
        total_amount: 0,
        payment_status: "PC",
        identifier: "Domestic",
        bkg_ref_id: "",
        priority: false,
        registered_flag: false,
      },
    ]),
  });
  record(
    "POST /v1/label/create/domestic",
    label.response.ok && (label.isPdf || label.bytes > 100),
    `HTTP ${label.response.status} ${label.elapsed}ms pdf=${label.isPdf} bytes=${label.bytes} ${label.isPdf ? "" : summarizeJson(label.json) || label.text.slice(0, 160)}`
  );

  printSummary();
  if (results.some((row) => !row.ok && row.name !== "GET /v1/event/download")) {
    process.exit(2);
  }
}

function printSummary() {
  console.log("\nSUMMARY");
  for (const row of results) {
    console.log(`${row.ok ? "PASS" : "FAIL"}\t${row.name}`);
  }
}

main().catch((error) => {
  console.error("PROBE_ERROR", error instanceof Error ? error.message : error);
  process.exit(1);
});

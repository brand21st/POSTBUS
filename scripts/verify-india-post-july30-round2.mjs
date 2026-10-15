const BASE = "https://test.cept.gov.in/beextcustomer";
const USERNAME = "9999999999";
const PASSWORD = "Dop@1234";
const CUSTOMER_ID = "3000064781";

function s10(prefix, serial, suffix) {
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const digits = String(serial).padStart(8, "0");
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const remainder = sum % 11;
  let check = 11 - remainder;
  if (check === 10) check = 0;
  if (check === 11) check = 5;
  return `${prefix}${digits}${check}${suffix}`;
}

function record(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${String(detail).slice(0, 350)}`);
}

async function jsonReq(path, init = {}) {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, init);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { response, json, text, elapsed: Date.now() - started };
}

function article(barcode, articleType, bulkReference) {
  return {
    bulk_customer_id: CUSTOMER_ID,
    contract_id: "41585456",
    barcode_no: barcode,
    pickup_or_dropoff: "DROPOFF",
    pickup_dropoff_office_id: 21360043,
    article_type: articleType,
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
    bulk_reference: bulkReference,
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
}

async function main() {
  const bad = await jsonReq("/v1/access/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "0000000000", password: "wrong" }),
  });
  record("login rejection", !bad.response.ok || bad.json?.success === false, `HTTP ${bad.response.status}`);

  const login = await jsonReq("/v1/access/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const token = login.json?.data?.access_token;
  if (!token) {
    record("login", false, "no token");
    process.exit(1);
  }

  const pinBad = await jsonReq("/v1/pincode-search?pincode=000000&office-type=post", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const pinOffices = Array.isArray(pinBad.json?.data) ? pinBad.json.data : [];
  record("invalid pincode 000000", pinBad.response.status >= 400 || pinOffices.length === 0, `HTTP ${pinBad.response.status} offices=${pinOffices.length}`);

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const spCode = s10("ET", 21433010, "IN");
  const sp = await jsonReq(`/process-articles/${CUSTOMER_ID}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ articles: [article(spCode, "SP", "B".repeat(50))] }),
  });
  const spValid = (sp.json?.valid_articles || []).length;
  const spErrors = sp.json?.error_articles?.[0]?.errors || [];
  record(
    `booking SP unique ${spCode}`,
    sp.response.ok && spValid >= 1,
    `HTTP ${sp.response.status} valid=${spValid} errors=${JSON.stringify(spErrors).slice(0, 180)} summary=${JSON.stringify(sp.json?.summary || {})}`
  );

  const inlandCode = s10("ET", 21433011, "IN");
  const inland = await jsonReq(`/process-articles/${CUSTOMER_ID}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ articles: [article(inlandCode, "SP_INLAND_DOC", "postbus-inland")] }),
  });
  const inlandValid = (inland.json?.valid_articles || []).length;
  const inlandErrors = inland.json?.error_articles?.[0]?.errors || inland.json?.errors || [];
  record(
    `booking SP_INLAND_DOC ${inlandCode}`,
    inland.response.ok && inlandValid >= 1,
    `HTTP ${inland.response.status} valid=${inlandValid} errors=${JSON.stringify(inlandErrors).slice(0, 220)}`
  );

  const track = await jsonReq("/v1/tracking/bulk", {
    method: "POST",
    headers,
    body: JSON.stringify({ bulk: [spCode, "RK775227016IN"] }),
  });
  record("tracking two articles", track.response.ok && Array.isArray(track.json?.data), `HTTP ${track.response.status} rows=${track.json?.data?.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

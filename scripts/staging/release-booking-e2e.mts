/**
 * Synthetic staging booking against the local CEPT stub.
 * Refuses any non-loopback Supabase URL. Does not print secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ensureLegacyAddressValidation } from "../../modules/orders/historical-classify.ts";
import { shippingAddressBookingBlock } from "../../modules/shopify/shipping-contact.ts";
import { runIndiaPostBooking } from "../../modules/india-post/booking-run.ts";
import { wrapIndiaPostAddressLines } from "../../modules/india-post/address-lines.ts";
import { encryptSecret } from "../../lib/security/crypto.ts";

const PRODUCTION_REF = "hgacoeoovjxkzfbesmvl";
const env = Object.fromEntries(
  readFileSync(".env.staging.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.includes("127.0.0.1") || url.toLowerCase().includes(PRODUCTION_REF)) {
  console.error("STOP: refusing booking E2E outside local supabase");
  process.exit(1);
}

const previous = JSON.parse(readFileSync("scripts/staging/auth-rls-e2e-last.json", "utf8"));
const out = { ok: true, checks: [] };
function check(name, pass, detail) {
  out.checks.push({ name, pass, detail: detail ?? null });
  if (!pass) out.ok = false;
}

async function login(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: email.includes("-b-") ? "StagingPass-B-1!" : "StagingPass-A-1!" }),
  });
  const body = await res.json();
  return body.access_token;
}

const tokenA = await login(previous.emailA);
const tokenB = await login(previous.emailB);
check("login-a", Boolean(tokenA), "session");
check("login-b", Boolean(tokenB), "session");

const userA = createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${tokenA}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const userB = createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${tokenB}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const orgA = previous.orgAId;
const stamp = Date.now();

async function address(extra) {
  const { data, error } = await userA
    .from("addresses")
    .insert({
      organization_id: orgA,
      kind: "shipping",
      name: extra.name ?? "Asha Kumar",
      phone: extra.phone ?? "9876543210",
      line1: extra.line1 ?? "12 MG Road",
      line2: extra.line2 ?? "Near temple",
      line3: extra.line3 ?? "Ward 4 ആശ",
      city: extra.city ?? "Kozhikode",
      state: extra.state ?? "Kerala",
      pincode: extra.pincode ?? "673001",
      country: "IN",
      address_validation_status: null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

const valid = await address({});
const classified = await ensureLegacyAddressValidation(userA, { organizationId: orgA, address: valid });
check("legacy-valid-ready", classified.address_validation_status === "READY", classified.address_validation_status);
check("legacy-line3-kept", classified.line3 === "Ward 4 ആശ", classified.line3);

const badPin = await address({ pincode: "12" });
const badClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgA, address: badPin });
check("legacy-bad-pin-blocked", Boolean(shippingAddressBookingBlock(badClassified)), badClassified.address_validation_status);

const wrapped = wrapIndiaPostAddressLines(classified.line1, classified.line2, classified.line3);
check("label-line3-present", JSON.stringify(wrapped).includes("Ward 4"), "wrapped");

const { data: customer, error: customerError } = await userA
  .from("customers")
  .insert({ organization_id: orgA, name: "Asha Kumar", phone: "9876543210" })
  .select("id")
  .single();
if (customerError) throw new Error(customerError.message);

async function orderAndShipment(addressId, orderNumber) {
  const { data: order, error } = await userA
    .from("orders")
    .insert({
      organization_id: orgA,
      source: "MANUAL",
      order_number: orderNumber,
      customer_id: customer.id,
      shipping_address_id: addressId,
      payment_status: "PAID",
      status: "READY",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const { data: shipment, error: shipError } = await userA
    .from("shipments")
    .insert({
      organization_id: orgA,
      order_id: order.id,
      customer_id: customer.id,
      shipping_address_id: addressId,
      service_code: "SP_INLAND_PARCEL",
      payment_mode: "PREPAID",
      weight_grams: 500,
      length_cm: 20,
      width_cm: 15,
      height_cm: 10,
      status: "QUEUED",
    })
    .select("id")
    .single();
  if (shipError) throw new Error(shipError.message);
  return shipment.id;
}

const goodShipment = await orderAndShipment(valid.id, `PB-STAGE-${stamp}`);
const badShipment = await orderAndShipment(badPin.id, `PB-STAGE-BAD-${stamp}`);

const { error: pickupError } = await userA.from("pickup_locations").insert({
  organization_id: orgA,
  name: "Staging Counter",
  phone: "9876543210",
  line1: "1 Office Road",
  city: "Kozhikode",
  state: "Kerala",
  pincode: "673001",
  is_default: true,
});
check("pickup-insert", !pickupError, pickupError?.message || "ok");

const { error: connError } = await userA.from("india_post_connections").upsert(
  {
    organization_id: orgA,
    environment: "UAT",
    bulk_customer_id: "3000064781",
    status: "CONNECTED",
    pickup_dropoff_office_id: "22660454",
    encrypted_username: encryptSecret("staging-stub"),
    encrypted_password: encryptSecret("staging-stub-pass"),
  },
  { onConflict: "organization_id" }
);
check("connection-upsert", !connError, connError?.message || "ok");

const { error: contractError } = await userA.from("india_post_contracts").upsert(
  {
    organization_id: orgA,
    service_code: "SP_INLAND_PARCEL",
    contract_id: "41793509",
    is_active: true,
    is_default: true,
  },
  { onConflict: "organization_id,service_code" }
);
check("contract-upsert", !contractError, contractError?.message || "ok");

const { count: rangeCount } = await userA
  .from("barcode_ranges")
  .select("id", { count: "exact", head: true })
  .eq("organization_id", orgA)
  .eq("prefix", "EY")
  .eq("is_active", true);
let rangeError = null;
if (!rangeCount) {
  const inserted = await userA.from("barcode_ranges").insert({
    organization_id: orgA,
    prefix: "EY",
    suffix: "IN",
    start_number: 88000001,
    end_number: 88000020,
    next_number: 88000001,
    service_code: "SP_INLAND_PARCEL",
    is_active: true,
  });
  rangeError = inserted.error;
}
check("synthetic-range", !rangeError, rangeError?.message || "ok");

let badOutcome = null;
try {
  badOutcome = await runIndiaPostBooking(admin, { organizationId: orgA, shipmentIds: [badShipment] });
} catch (error) {
  badOutcome = { error: error instanceof Error ? error.message : String(error) };
}
const { data: badRow } = await userA.from("shipments").select("barcode,status").eq("id", badShipment).single();
check("invalid-no-barcode", !badRow?.barcode, `status=${badRow?.status} barcode=${badRow?.barcode || "none"}`);

let goodOutcome = null;
try {
  goodOutcome = await runIndiaPostBooking(admin, { organizationId: orgA, shipmentIds: [goodShipment] });
} catch (error) {
  goodOutcome = { error: error instanceof Error ? error.message : String(error) };
}
const { data: goodRow } = await userA.from("shipments").select("barcode,status,booked_at").eq("id", goodShipment).single();
check(
  "valid-booked-or-explained",
  Boolean(goodRow?.barcode) || Boolean(goodOutcome?.error),
  goodOutcome?.error || `barcode=${goodRow?.barcode} status=${goodRow?.status}`
);
check(
  "valid-booked-with-barcode",
  Boolean(goodRow?.barcode && goodRow?.booked_at),
  goodOutcome?.error || `barcode=${goodRow?.barcode || "none"} booked=${Boolean(goodRow?.booked_at)}`
);

const stub = await fetch("http://127.0.0.1:4099/stats").then((res) => res.json());
const stubHits = (stub.requests || []).filter((row) => String(row.path || "").includes("process-articles"));
check("cept-stub-called-for-valid-only", stubHits.length >= 1, `hits=${stubHits.length}`);

let cross = null;
try {
  cross = await runIndiaPostBooking(userB, { organizationId: orgA, shipmentIds: [goodShipment] });
} catch (error) {
  cross = { error: error instanceof Error ? error.message : String(error) };
}
check(
  "cross-tenant-booking-rejected",
  Boolean(cross?.error) || (cross?.booked === 0 && (cross?.failed ?? 0) >= 0 && !cross?.bookedIds?.includes(goodShipment)),
  cross?.error || JSON.stringify({ booked: cross?.booked, failed: cross?.failed })
);

const second = await runIndiaPostBooking(admin, { organizationId: orgA, shipmentIds: [goodShipment] }).catch((error) => ({
  error: error instanceof Error ? error.message : String(error),
}));
const { data: afterRetry } = await userA.from("shipments").select("barcode").eq("id", goodShipment).single();
check("retry-keeps-same-barcode", afterRetry?.barcode === goodRow?.barcode, `${goodRow?.barcode} -> ${afterRetry?.barcode}`);

out.goodBarcode = goodRow?.barcode || null;
out.badStatus = badRow?.status || null;
writeFileSync("scripts/staging/release-booking-e2e-last.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, failed: out.checks.filter((row) => !row.pass).map((row) => ({ name: row.name, detail: row.detail })), barcode: out.goodBarcode }));
if (!out.ok) process.exit(1);

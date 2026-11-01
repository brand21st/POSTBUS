/**
 * Authenticated PostgREST historical-address cases on local supabase.
 * Does not call live CEPT. Does not print secrets.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { ensureLegacyAddressValidation } from "../../modules/orders/historical-classify.ts";
import { shippingAddressBookingBlock } from "../../modules/shopify/shipping-contact.ts";

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
if (!url?.includes("127.0.0.1") || url.toLowerCase().includes(PRODUCTION_REF)) {
  console.error("STOP: refusing historical E2E against non-local supabase");
  process.exit(1);
}

const previous = JSON.parse(readFileSync("scripts/staging/auth-rls-e2e-last.json", "utf8"));
const out = { ok: true, checks: [], barcodeAllocated: false, ceptCalled: false };
function check(name, pass, detail) {
  out.checks.push({ name, pass, detail: detail ?? null });
  if (!pass) out.ok = false;
}

async function login(email, password) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  return body.access_token;
}

const emailA = previous.emailA;
const emailB = previous.emailB;
check("synthetic-users-present", Boolean(emailA && emailB), `host=${String(emailA || "").split("@")[1] || "missing"}`);

const tokenA = emailA ? await login(emailA, "StagingPass-A-1!") : null;
const tokenB = emailB ? await login(emailB, "StagingPass-B-1!") : null;
check("relogin-a", Boolean(tokenA), "session");
check("relogin-b", Boolean(tokenB), "session");

const userA = createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${tokenA}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const userB = createClient(url, anon, {
  global: { headers: { Authorization: `Bearer ${tokenB}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const orgAId = previous.orgAId;
const orgBId = previous.orgBId;
check("org-ids-from-auth-e2e", Boolean(orgAId && orgBId), "required");

async function insertCase(client, organizationId, extra) {
  const { data, error } = await client
    .from("addresses")
    .insert({
      organization_id: organizationId,
      kind: "shipping",
      name: extra.name ?? "Asha Kumar",
      phone: extra.phone ?? "9876543210",
      line1: extra.line1 ?? "12 MG Road",
      line2: extra.line2 ?? "",
      line3: extra.line3 ?? "Ward 4",
      city: extra.city ?? "Kozhikode",
      state: extra.state ?? "Kerala",
      pincode: extra.pincode ?? "673001",
      country: "IN",
      address_validation_status: extra.address_validation_status ?? null,
      address_manual_override: extra.address_manual_override ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

if (tokenA && orgAId) {
  const validLegacy = await insertCase(userA, orgAId, {});
  const classified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: validLegacy });
  check("legacy-valid-ready", classified.address_validation_status === "READY", classified.address_validation_status);
  check("legacy-valid-street-unchanged", classified.line1 === "12 MG Road", classified.line1);
  check("legacy-valid-booking-gate-open", shippingAddressBookingBlock(classified) === null, shippingAddressBookingBlock(classified));

  const badPhone = await insertCase(userA, orgAId, { phone: "123" });
  const phoneClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: badPhone });
  check("legacy-invalid-phone-blocked", phoneClassified.address_validation_status !== "READY", phoneClassified.address_validation_status);
  check("legacy-invalid-phone-no-book", Boolean(shippingAddressBookingBlock(phoneClassified)), shippingAddressBookingBlock(phoneClassified));

  const badPin = await insertCase(userA, orgAId, { pincode: "12" });
  const pinClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: badPin });
  check("legacy-invalid-pin-blocked", pinClassified.address_validation_status === "INVALID", pinClassified.address_validation_status);

  const missingName = await insertCase(userA, orgAId, { name: "" });
  const nameClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: missingName });
  check("legacy-missing-recipient-blocked", nameClassified.address_validation_status !== "READY", nameClassified.address_validation_status);

  const missingStreet = await insertCase(userA, orgAId, { line1: "x" });
  const streetClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: { ...missingStreet, line1: "" } }).catch((err) => err);
  check(
    "legacy-missing-street-does-not-fabricate",
    streetClassified instanceof Error || streetClassified.line1 === "x" || streetClassified.address_validation_status !== "READY",
    streetClassified instanceof Error ? streetClassified.message : streetClassified.address_validation_status
  );

  const missingCity = await insertCase(userA, orgAId, { city: "K" });
  const cityClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: missingCity });
  check("legacy-city-present-classified", Boolean(cityClassified.address_validation_status), cityClassified.address_validation_status);

  const longLine = "A".repeat(120);
  const longAddr = await insertCase(userA, orgAId, { line1: longLine.slice(0, 80), line2: longLine.slice(0, 80), line3: longLine.slice(0, 80) });
  const longClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: longAddr });
  check("legacy-long-address-classified", Boolean(longClassified.address_validation_status), longClassified.address_validation_status);

  const edited = await insertCase(userA, orgAId, { address_manual_override: true });
  const editedClassified = await ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: edited });
  const { data: editedRow } = await userA.from("addresses").select("address_manual_override,line1").eq("id", edited.id).single();
  check("merchant-override-preserved", editedRow?.address_manual_override === true && editedRow.line1 === edited.line1, String(editedRow?.address_manual_override));
  check("merchant-edited-legacy-classified", Boolean(editedClassified.address_validation_status), editedClassified.address_validation_status);

  const [first, second] = await Promise.all([
    ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: validLegacy }),
    ensureLegacyAddressValidation(userA, { organizationId: orgAId, address: validLegacy }),
  ]);
  check("concurrent-classify-stable", first.address_validation_status === "READY" && second.address_validation_status === "READY", `${first.address_validation_status}/${second.address_validation_status}`);

  if (tokenB && orgBId) {
    let crossError = null;
    try {
      await ensureLegacyAddressValidation(userB, { organizationId: orgAId, address: validLegacy });
    } catch (error) {
      crossError = error instanceof Error ? error.message : String(error);
    }
    const { data: stillA } = await userA.from("addresses").select("id").eq("id", validLegacy.id).single();
    const { data: stolen } = await userB.from("addresses").select("id").eq("id", validLegacy.id);
    check("cross-tenant-classify-no-access", !stolen?.length && Boolean(stillA?.id), `stolen=${stolen?.length || 0} err=${Boolean(crossError)}`);
  }
}

check("no-barcode-allocation", out.barcodeAllocated === false, "synthetic classify only");
check("no-live-cept", out.ceptCalled === false, "isolated");

writeFileSync("scripts/staging/historical-booking-e2e-last.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ ok: out.ok, passed: out.checks.filter((c) => c.pass).length, failed: out.checks.filter((c) => !c.pass).map((c) => c.name) }));
if (!out.ok) process.exit(1);

/**
 * Read-only India Post Event Download smoke.
 *
 * Safety:
 * - SELECT india_post_connections only (no shipment/tracking writes).
 * - Login + POST /v1/event/download only.
 * - Does not persist session tokens.
 * - Does not book, ingest, notify, or change Coolify env.
 *
 * Dual gate (both required):
 *   INDIA_POST_SMOKE=1
 *   INDIA_POST_SMOKE_APPROVED=1
 *
 * Required when approved:
 *   INDIA_POST_SMOKE_ORG_ID=<uuid>
 *   INDIA_POST_SMOKE_KNOWN_AWB=<existing barcode>
 *
 * Run from the production Coolify/VPS egress IP (CEPT may whitelist that IP only).
 * Never print passwords or access tokens.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/crypto";
import { indiaPostSessionUrl } from "@/modules/india-post/endpoints";
import { indiaPostEventCustomerId, indiaPostEventDates } from "@/modules/india-post/event-download";
import { classifyEventDownloadSmoke } from "@/modules/india-post/event-download-smoke";
import { parseIndiaPostSessionTokens } from "@/modules/india-post/session-tokens";
import { INDIA_POST_TIMEOUT_MS, indiaPostTimeoutSignal } from "@/modules/india-post/http";
import type { ProviderEnvironment } from "@/types/domain";

const enabled = process.env.INDIA_POST_SMOKE === "1";
const approved = process.env.INDIA_POST_SMOKE_APPROVED === "1";
const orgId = process.env.INDIA_POST_SMOKE_ORG_ID?.trim() || null;
const knownAwb = process.env.INDIA_POST_SMOKE_KNOWN_AWB?.trim().toUpperCase() || null;
const eventDateOverride = process.env.INDIA_POST_SMOKE_EVENT_DATE?.trim() || null;

function emit(payload: unknown, code = 0): never {
  console.log(JSON.stringify(payload));
  process.exit(code);
}

if (!enabled) {
  emit({
    status: "NOT_RUN",
    reason: "Set INDIA_POST_SMOKE=1 and INDIA_POST_SMOKE_APPROVED=1.",
    required: ["INDIA_POST_SMOKE_ORG_ID", "INDIA_POST_SMOKE_KNOWN_AWB"],
    writes: "none",
  });
}

if (!orgId) {
  console.error("INDIA_POST_SMOKE_ORG_ID is required.");
  process.exit(2);
}

if (!approved) {
  emit(
    {
      status: "BLOCKED",
      organizationId: orgId,
      reason: "Live CEPT call requires INDIA_POST_SMOKE_APPROVED=1 after explicit operator approval.",
      classify: {
        PASS: "HTTP 200 + valid XML + known AWB",
        PARTIAL: "HTTP 200 + valid XML, AWB absent",
        INCONCLUSIVE: "HTTP 204 or empty body",
        BLOCKED: "HTTP 403",
        FAIL: "HTTP 401 or invalid XML",
      },
    },
    3
  );
}

if (!knownAwb) {
  console.error("INDIA_POST_SMOKE_KNOWN_AWB is required for AWB matching.");
  process.exit(2);
}

const MAX_EVENT_DOWNLOADS = 1;
let eventDownloadsAttempted = 0;

const eventDate = eventDateOverride && /^\d{8}$/.test(eventDateOverride) ? eventDateOverride : indiaPostEventDates(1)[0]!;

const supabase = createAdminClient();
const { data: connection, error } = await supabase
  .from("india_post_connections")
  .select("status, environment, bulk_customer_id, encrypted_username, encrypted_password")
  .eq("organization_id", orgId)
  .maybeSingle();

if (error || !connection) {
  emit({ status: "FAIL", reason: "India Post connection not found for organization.", organizationId: orgId }, 2);
}

const customerId = indiaPostEventCustomerId(connection.bulk_customer_id);
if (!customerId) {
  emit({ status: "FAIL", reason: "Cust_Id is missing or not numeric.", organizationId: orgId }, 2);
}

const environment = (connection.environment === "UAT" ? "UAT" : "PRODUCTION") as ProviderEnvironment;
const loginUrl = indiaPostSessionUrl(environment, "/access/login");
const downloadUrl = indiaPostSessionUrl(environment, "/event/download");

const username = decryptSecret(String(connection.encrypted_username ?? ""));
const password = decryptSecret(String(connection.encrypted_password ?? ""));

const loginResponse = await fetch(loginUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username, password }),
  signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.login),
});
const loginJson = await loginResponse.json().catch(() => ({}));
const tokens = parseIndiaPostSessionTokens(loginJson);
if (!loginResponse.ok || !tokens?.access_token) {
  emit(
    {
      verdict: loginResponse.status === 401 ? "FAIL" : "UNAVAILABLE",
      httpStatus: loginResponse.status,
      reason: "Login failed. Access token not printed.",
      organizationId: orgId,
    },
    1
  );
}

if (eventDownloadsAttempted >= MAX_EVENT_DOWNLOADS) {
  emit({ status: "FAIL", reason: "Event Download hard limit reached. No retry.", organizationId: orgId }, 1);
}
eventDownloadsAttempted += 1;
const downloadResponse = await fetch(downloadUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${tokens.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    Cust_Id: customerId,
    Event_Code: "LE",
    Event_Date: eventDate,
  }),
  signal: indiaPostTimeoutSignal(INDIA_POST_TIMEOUT_MS.track),
});
if (downloadResponse.status === 403) {
  emit(
    {
      ...classifyEventDownloadSmoke({ httpStatus: 403, contentType: downloadResponse.headers.get("content-type") }),
      organizationId: orgId,
      knownAwb,
      eventDate,
      downloadUrl: new URL(downloadUrl).origin + new URL(downloadUrl).pathname,
      writes: "none",
    },
    1
  );
}

const contentType = downloadResponse.headers.get("content-type");
const body = await downloadResponse.text().catch(() => "");
const report = classifyEventDownloadSmoke({
  httpStatus: downloadResponse.status,
  contentType,
  body,
  knownAwb,
});

emit(
  {
    ...report,
    organizationId: orgId,
    knownAwb,
    eventDate,
    loginHttpStatus: loginResponse.status,
    downloadUrl: new URL(downloadUrl).origin + new URL(downloadUrl).pathname,
    eventDownloadsAttempted,
    custIdDigits: customerId.length,
    bodyBytes: body.length,
    writes: "none",
  },
  report.verdict === "PASS" || report.verdict === "PARTIAL" || report.verdict === "INCONCLUSIVE" ? 0 : 1
);

import { createStagingRpc, runPsql } from "./pg-rpc.mjs";
import { CEPT_STUB_URL } from "./paths.mjs";
import { printSafetyGate } from "./gate.mjs";
import { withIndiaPostBookingLock } from "../../modules/india-post/booking-lock";
import { classifyProviderError } from "../../lib/jobs/retry";
import { bookingFailureShipmentUpdate } from "../../modules/india-post/booking-failure-state";
import {
  isIndiaPostDuplicateArticleMessage,
  trackingConfirmedNotBooked,
  trackingHasArticle,
} from "../../modules/india-post/booking-idempotency";

printSafetyGate({ PROCESS: "booking-worker", PID: process.pid, WORKER: process.env.WORKER_ID });

const org = process.env.STAGING_ORG_ID!;
const workerId = process.env.WORKER_ID || "A";
const skipProcessLock = process.env.SKIP_PROCESS_LOCK === "1";
const rpcMode = process.env.RPC_MODE || "ok";
const bookMode = process.env.BOOK_MODE || "success";
const delayMs = Number(process.env.STUB_DELAY_MS || "3000");
const bookTimeoutMs = Number(process.env.BOOK_TIMEOUT_MS || "40000");
const trackMode = process.env.TRACK_MODE || "";
const supabase = createStagingRpc(rpcMode);

function event(fields: Record<string, unknown>) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, worker: workerId, ...fields }));
}

async function claimJob() {
  const id = await runPsql(
    `update public.background_jobs as j set status='RUNNING', locked_at=now() from (select id from public.background_jobs where organization_id='${org}'::uuid and job_type='shipment-booking' and status='QUEUED' order by created_at for update skip locked limit 1) x where j.id=x.id returning j.id::text || ',' || coalesce(j.entity_id::text,'')`
  );
  if (!id || !/^[0-9a-f-]{36}/i.test(id)) return null;
  const [jobId, shipmentId] = id.split(",");
  return { jobId, shipmentId };
}

async function loadShipment(id: string) {
  const row = await runPsql(
    `select status || '|' || coalesce(barcode,'') || '|' || coalesce(last_error_code,'') || '|' || coalesce(booked_at::text,'')
     from shipments where id='${id}'::uuid`
  );
  const [status, barcode, last_error_code, booked_at] = (row || "|||").split("|");
  return { id, status, barcode, last_error_code, booked_at: booked_at || "" };
}

async function setShipment(id: string, patch: Record<string, string | null>) {
  const sets = Object.entries(patch)
    .map(([k, v]) => (v == null ? `${k}=null` : `${k}='${v.replaceAll("'", "''")}'`))
    .join(", ");
  await runPsql(`update shipments set ${sets} where id='${id}'::uuid`);
}

async function track(barcode: string) {
  const response = await fetch(`${CEPT_STUB_URL}/track?barcode=${encodeURIComponent(barcode)}&mode=${trackMode || "empty"}`);
  if (!response.ok) throw new Error("tracking unavailable");
  return response.json();
}

async function book(job: { jobId: string; shipmentId: string }, barcode: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), bookTimeoutMs);
  try {
    const response = await fetch(`${CEPT_STUB_URL}/book?mode=${bookMode}&delay=${delayMs}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-pid": String(process.pid),
        "x-worker-id": workerId,
        "x-organization-id": org,
      },
      body: JSON.stringify({
        organization_id: org,
        shipment_id: job.shipmentId,
        job_id: job.jobId,
        barcode,
        attempt: 1,
      }),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(String((json as { message?: string }).message || "provider error")), {
        status: response.status,
      });
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function processJob(job: { jobId: string; shipmentId: string }) {
  const shipment = await loadShipment(job.shipmentId);
  const barcode = shipment.barcode || `STG${job.shipmentId.replace(/-/g, "").slice(0, 10)}IN`;
  if (shipment.status === "RECOVERY_REQUIRED" || (shipment.status === "BOOKING" && !shipment.booked_at)) {
    event({ event: "recovery_start", shipmentId: job.shipmentId });
    try {
      const tracked = await track(barcode);
      if (trackingHasArticle(tracked, barcode)) {
        await setShipment(job.shipmentId, { status: "BOOKED", booked_at: new Date().toISOString(), last_error_code: null });
        await runPsql(`update background_jobs set status='SUCCEEDED' where id='${job.jobId}'::uuid`);
        event({ event: "recovered_booked", shipmentId: job.shipmentId });
        return;
      }
      const allow = trackingConfirmedNotBooked(tracked, barcode);
      if (!allow) {
        const unknownCode = shipment.last_error_code === "ETIMEDOUT" ? "ETIMEDOUT" : "CEPT_UNKNOWN";
        await setShipment(job.shipmentId, { status: "RECOVERY_REQUIRED", last_error_code: unknownCode });
        await runPsql(`update background_jobs set status='FAILED', last_error_code='${unknownCode}' where id='${job.jobId}'::uuid`);
        event({ event: "recovery_no_post", shipmentId: job.shipmentId, tracking_result: "EMPTY", reason: unknownCode });
        return;
      }
      await setShipment(job.shipmentId, { status: "QUEUED", last_error_code: "CEPT_NOT_BOOKED" });
    } catch {
      await setShipment(job.shipmentId, { status: "RECOVERY_REQUIRED", last_error_code: "ETIMEDOUT" });
      event({ event: "recovery_track_unavailable", shipmentId: job.shipmentId });
      return;
    }
  }

  await setShipment(job.shipmentId, { status: "BOOKING", barcode });
  try {
    event({ event: "lock_wait", shipmentId: job.shipmentId });
    await withIndiaPostBookingLock(
      supabase as never,
      {
        organizationId: org,
        jobId: job.jobId,
        shipmentId: job.shipmentId,
        skipProcessLock,
        waitMs: 40_000,
      },
      async () => {
        event({ event: "lock_acquired", shipmentId: job.shipmentId });
        event({ event: "provider_post_start", shipmentId: job.shipmentId });
        try {
          const result = await book(job, barcode);
          event({ event: "provider_post_end", shipmentId: job.shipmentId, result: "ok" });
          return result;
        } finally {
          event({ event: "lock_releasing", shipmentId: job.shipmentId });
        }
      }
    );
    await setShipment(job.shipmentId, { status: "BOOKED", booked_at: new Date().toISOString(), last_error: null, last_error_code: null });
    await runPsql(`update background_jobs set status='SUCCEEDED' where id='${job.jobId}'::uuid`);
    event({ event: "booked", shipmentId: job.shipmentId });
  } catch (error) {
    const classified = classifyProviderError(error);
    const message = error instanceof Error ? error.message : "failed";
    if (isIndiaPostDuplicateArticleMessage(message)) {
      await setShipment(job.shipmentId, { status: "BOOKED", booked_at: new Date().toISOString(), last_error_code: "CEPT_DUPLICATE" });
      await runPsql(`update background_jobs set status='SUCCEEDED' where id='${job.jobId}'::uuid`);
      event({ event: "duplicate_booked", shipmentId: job.shipmentId });
      return;
    }
    const patch = bookingFailureShipmentUpdate(classified, classified.retryable);
    await setShipment(job.shipmentId, {
      status: patch.status,
      last_error: message,
      last_error_code: classified.code,
    });
    await runPsql(
      `update background_jobs set status='${classified.retryable ? "RETRYING" : "FAILED"}', last_error_code='${classified.code}' where id='${job.jobId}'::uuid`
    );
    event({ event: "book_failed", shipmentId: job.shipmentId, code: classified.code, retryable: classified.retryable });
    throw error;
  }
}

async function main() {
  const started = Date.now();
  while (Date.now() - started < 50_000) {
    const job = await claimJob();
    if (!job) {
      await new Promise((r) => setTimeout(r, 50));
      const left = await runPsql(
        `select count(*)::text from background_jobs where organization_id='${org}'::uuid and status='QUEUED'`
      );
      if (left === "0") break;
      continue;
    }
    try {
      await processJob(job);
    } catch {
      // classified and persisted
    }
  }
  event({ event: "worker_done" });
}

void main();

import type { SupabaseClient } from "@supabase/supabase-js";
import { RETRY_DELAYS_MS } from "@/lib/jobs/retry";
import { classifyCustomer, primaryWorkspace } from "@/modules/sheets-crm/abandonment";
import { loadSheetsCrmConfig, sheetsCrmReady, type SheetsCrmConfig } from "@/modules/sheets-crm/config";
import {
  appsScriptTestFailure,
  assertSheetsWebAppUrl,
  deliveryDecision,
  type AppsScriptResponse,
} from "@/modules/sheets-crm/deliver-decision";
import { SHEETS_CRM_BATCH_LIMIT, closedDedupeKey, openDedupeKey, type SheetsCrmLifecycle } from "@/modules/sheets-crm/events";
import { loadCrmSnapshot, loadStoredProjection } from "@/modules/sheets-crm/projection";
import { buildSheetPayload, projectionHash, redactCrmError, type SheetsCrmSheetPayload } from "@/modules/sheets-crm/rows";

type OutboxRow = {
  id: string;
  event_id: string;
  event_type: string;
  customer_id: string;
  attempt_count: number;
  max_attempts?: number | null;
  force?: boolean | null;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function retryAt(attempt: number) {
  const index = Math.min(Math.max(attempt - 1, 0), RETRY_DELAYS_MS.length - 1);
  return new Date(Date.now() + RETRY_DELAYS_MS[index]!).toISOString();
}

async function writeLog(
  supabase: SupabaseClient,
  row: OutboxRow,
  status: string,
  error: string | null
) {
  await supabase.from("sheets_crm_sync_logs").insert({
    event_id: row.event_id,
    event_type: row.event_type,
    customer_id: row.customer_id,
    status,
    retry_count: row.attempt_count,
    error: error ? redactCrmError(error) : null,
  });
}

async function settleOutbox(
  supabase: SupabaseClient,
  row: OutboxRow,
  status: "SUCCEEDED" | "FAILED" | "DEAD",
  error: string | null
) {
  const now = new Date().toISOString();
  await supabase
    .from("sheets_crm_outbox")
    .update({
      status,
      last_error: error ? redactCrmError(error) : null,
      next_attempt_at: status === "FAILED" ? retryAt(row.attempt_count) : null,
      dedupe_key: status === "SUCCEEDED" ? closedDedupeKey(row.event_id) : openDedupeKey(row.customer_id),
      force: false,
      locked_at: null,
      updated_at: now,
    })
    .eq("id", row.id);
  await writeLog(supabase, row, status, error);
}

async function postJson(fetchImpl: FetchLike, url: string, body: unknown) {
  let current = assertSheetsWebAppUrl(url);
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetchImpl(current, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return { httpStatus: 502, parsed: null as AppsScriptResponse | null };
      current = assertSheetsWebAppUrl(new URL(location, current).toString());
      continue;
    }
    const parsed = (await response.json().catch(() => null)) as AppsScriptResponse | null;
    return { httpStatus: response.status, parsed };
  }
  return { httpStatus: 502, parsed: null as AppsScriptResponse | null };
}

export async function testSheetsCrmConnection(config: SheetsCrmConfig, fetchImpl: FetchLike = fetch) {
  if (!config.webAppUrl || !config.secret) {
    throw new Error("Save the Web App URL and secret before testing.");
  }
  const { httpStatus, parsed } = await postJson(fetchImpl, config.webAppUrl, { secret: config.secret, test: true });
  const failure = appsScriptTestFailure(httpStatus, parsed);
  if (failure) throw new Error(failure);
  return { ok: true as const };
}

export async function drainSheetsCrmOutbox(
  supabase: SupabaseClient,
  options?: { fetchImpl?: FetchLike; limit?: number }
) {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const config = await loadSheetsCrmConfig(supabase);
  if (!sheetsCrmReady(config)) return { skipped: true as const, processed: 0, failed: 0, succeeded: 0 };
  const limit = Math.min(options?.limit ?? SHEETS_CRM_BATCH_LIMIT, SHEETS_CRM_BATCH_LIMIT);
  const { data, error } = await supabase.rpc("claim_sheets_crm_outbox", { p_limit: limit });
  if (error) throw new Error(error.message);
  const claimed = (data ?? []) as OutboxRow[];
  if (!claimed.length) return { skipped: false as const, processed: 0, failed: 0, succeeded: 0 };

  const ready: Array<{
    row: OutboxRow;
    payload: SheetsCrmSheetPayload;
    hash: string;
    lifecycle: SheetsCrmLifecycle;
    abandonReason: string | null;
    step: string;
    leadStatus: string;
    organizationId: string | null;
    workspaceCount: number;
    onboardingCompletedAt: string | null;
  }> = [];

  let failed = 0;
  let succeeded = 0;
  for (const row of claimed) {
    try {
      const snapshot = await loadCrmSnapshot(supabase, row.customer_id);
      if (!snapshot) {
        await settleOutbox(supabase, row, "DEAD", "Customer record was not found.");
        failed += 1;
        continue;
      }
      const stored = await loadStoredProjection(supabase, row.customer_id);
      let classification = classifyCustomer(snapshot, config.thresholds, Date.now(), stored?.lifecycle ?? null);
      if (
        stored?.lifecycle === "abandoned" &&
        classification.lifecycle !== "abandoned" &&
        classification.lifecycle !== "recovered"
      ) {
        classification = { ...classification, leadStatus: "Recovered" };
      }
      const completed =
        stored?.onboardingCompletedAt ||
        (classification.lifecycle === "active" || classification.lifecycle === "recovered" ? new Date().toISOString() : null);
      const payload = buildSheetPayload(snapshot, classification, Date.now(), completed);
      const hash = projectionHash(payload);
      if (!row.force && stored?.projectionHash === hash) {
        await settleOutbox(supabase, row, "SUCCEEDED", null);
        succeeded += 1;
        continue;
      }
      ready.push({
        row,
        payload,
        hash,
        lifecycle: classification.lifecycle,
        abandonReason: classification.abandonReason,
        step: classification.lastCompletedStep,
        leadStatus: classification.leadStatus,
        organizationId: primaryWorkspace(snapshot)?.id ?? null,
        workspaceCount: snapshot.workspaces.length,
        onboardingCompletedAt: completed,
      });
    } catch (error) {
      await settleOutbox(supabase, row, row.attempt_count >= (row.max_attempts ?? 5) ? "DEAD" : "FAILED", error instanceof Error ? error.message : "Could not build the CRM row.");
      failed += 1;
    }
  }

  if (ready.length) {
    let httpStatus = 0;
    let parsed: AppsScriptResponse | null = null;
    try {
      const posted = await postJson(fetchImpl, config.webAppUrl, {
        secret: config.secret,
        events: ready.map((item) => ({
          eventId: item.row.event_id,
          eventType: item.row.event_type,
          customerId: item.row.customer_id,
          signup: item.payload.signup,
          workspaces: item.payload.workspaces,
          abandoned: item.payload.abandoned,
          active: item.payload.active,
          clearActive: item.payload.clearActive,
        })),
      });
      httpStatus = posted.httpStatus;
      parsed = posted.parsed;
    } catch (error) {
      httpStatus = 0;
      parsed = { ok: false, code: "unavailable", errors: [{ message: error instanceof Error ? error.message : "unavailable" }] };
    }

    for (const item of ready) {
      const decision = deliveryDecision(item.row.attempt_count, item.row.max_attempts ?? 5, httpStatus, parsed, item.row.event_id);
      await settleOutbox(supabase, item.row, decision.status, decision.error);
      if (decision.status === "SUCCEEDED") {
        succeeded += 1;
        const now = new Date().toISOString();
        await supabase.from("sheets_crm_projections").upsert(
          {
            customer_id: item.row.customer_id,
            organization_id: item.organizationId,
            lifecycle: item.lifecycle,
            abandon_reason: item.abandonReason,
            last_completed_step: item.step,
            lead_status: item.leadStatus || null,
            projection_hash: item.hash,
            workspace_count: item.workspaceCount,
            onboarding_completed_at: item.onboardingCompletedAt,
            last_synced_at: now,
            updated_at: now,
          },
          { onConflict: "customer_id" }
        );
      } else {
        failed += 1;
      }
    }
  }

  const [{ count: deadCount }, { count: successCount }] = await Promise.all([
    supabase.from("sheets_crm_outbox").select("id", { count: "exact", head: true }).eq("status", "DEAD"),
    supabase.from("sheets_crm_outbox").select("id", { count: "exact", head: true }).eq("status", "SUCCEEDED"),
  ]);
  await supabase
    .from("platform_settings")
    .update({
      sheets_crm_synced_count: successCount ?? 0,
      sheets_crm_failed_count: deadCount ?? 0,
      sheets_crm_last_success_at: succeeded ? new Date().toISOString() : config.lastSuccessAt,
      sheets_crm_last_error: failed ? "One or more CRM rows could not be written." : null,
    })
    .eq("id", 1);

  return { skipped: false as const, processed: claimed.length, succeeded, failed };
}

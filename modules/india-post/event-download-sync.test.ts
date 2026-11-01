import { afterEach, describe, expect, it, vi } from "vitest";

const previousAllowlist = process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST;
import {
  shouldRunHistoricalLookback,
  runOrganizationEventDownloadSync,
} from "@/modules/india-post/event-download-sync";
import { TRACKING_REFRESH_MESSAGES } from "@/modules/india-post/tracking-refresh-messages";
import { indiaPostEventDownloadLookbackDays } from "@/modules/india-post/spec";

describe("historical lookback scheduling", () => {
  afterEach(() => {
    delete process.env.INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_INTERVAL_MS;
    delete process.env.INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_DAYS;
    if (previousAllowlist == null) delete process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST;
    else process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = previousAllowlist;
  });

  it("runs lookback when overlap last_success_at is now but lookback never succeeded", () => {
    expect(shouldRunHistoricalLookback(null)).toBe(true);
    expect(shouldRunHistoricalLookback(undefined)).toBe(true);
  });

  it("does not treat a fresh overlap timestamp as lookback success", () => {
    const overlapNow = new Date().toISOString();
    expect(shouldRunHistoricalLookback(overlapNow)).toBe(false);
    expect(shouldRunHistoricalLookback(null, Date.now())).toBe(true);
  });

  it("runs daily lookback after the independent interval", () => {
    process.env.INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_INTERVAL_MS = String(20 * 60 * 60 * 1000);
    const stale = new Date(Date.now() - 21 * 60 * 60 * 1000).toISOString();
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(shouldRunHistoricalLookback(stale)).toBe(true);
    expect(shouldRunHistoricalLookback(recent)).toBe(false);
  });

  it("defaults historical lookback to 7 IST days and stays configurable", () => {
    expect(indiaPostEventDownloadLookbackDays()).toBe(7);
    process.env.INDIA_POST_EVENT_DOWNLOAD_LOOKBACK_DAYS = "10";
    expect(indiaPostEventDownloadLookbackDays()).toBe(10);
  });
});

describe("tracking refresh honesty", () => {
  it("does not report a shipment update for HTTP success with no new events", async () => {
    const { trackingRefreshKind, trackingRefreshMessage } = await import(
      "@/modules/india-post/tracking-refresh-messages"
    );
    expect(trackingRefreshKind({ httpStatus: 200, eventsInserted: 0 })).toBe("no_new_events");
    expect(trackingRefreshMessage({ httpStatus: 200, eventsInserted: 0 })).toBe(
      TRACKING_REFRESH_MESSAGES.noNewEvents
    );
    expect(trackingRefreshMessage({ httpStatus: 204, eventsInserted: 0 })).toBe(
      TRACKING_REFRESH_MESSAGES.noNewEvents
    );
    expect(trackingRefreshMessage({ eventsInserted: 1 })).toBe(TRACKING_REFRESH_MESSAGES.updated);
    expect(trackingRefreshMessage({ unauthorized: true })).toBe(TRACKING_REFRESH_MESSAGES.unauthorized);
    expect(trackingRefreshMessage({ httpStatus: 503 })).toBe(TRACKING_REFRESH_MESSAGES.unavailable);
  });
});

function memorySyncDb(shipments: Record<string, unknown>[] = []) {
  const checkpoints = new Map<string, Record<string, unknown>>();
  const lookbacks = new Map<string, Record<string, unknown>>();
  return {
    checkpoints,
    lookbacks,
    client: {
      from(table: string) {
        const filters: Record<string, string> = {};
        const api: Record<string, unknown> = {
          select: () => api,
          eq(column: string, value: string) {
            filters[column] = value;
            return api;
          },
          not: () => api,
          in: () => api,
          or: () => api,
          limit: () => api,
          update: () => api,
          maybeSingle: async () => {
            if (table === "tracking_sync_checkpoints") {
              const key = `${filters.organization_id}:${filters.cust_id}:${filters.event_date}`;
              return { data: checkpoints.get(key) ?? null, error: null };
            }
            if (table === "tracking_lookback_state") {
              const key = `${filters.organization_id}:${filters.cust_id}`;
              return { data: lookbacks.get(key) ?? null, error: null };
            }
            return { data: null, error: null };
          },
          upsert: async (row: Record<string, unknown>) => {
            if (table === "tracking_sync_checkpoints") {
              checkpoints.set(`${row.organization_id}:${row.cust_id}:${row.event_date}`, row);
            }
            if (table === "tracking_lookback_state") {
              lookbacks.set(`${row.organization_id}:${row.cust_id}`, row);
            }
            return { error: null };
          },
          then: (resolve: (value: { data: unknown[]; error: null }) => void) => {
            resolve({ data: table === "shipments" ? shipments : [], error: null });
          },
        };
        return api;
      },
    },
  };
}

describe("overlap does not write lookback state", () => {
  afterEach(() => {
    if (previousAllowlist == null) delete process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST;
    else process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = previousAllowlist;
  });

  it("overlap success leaves last_lookback_success_at empty so recon still runs", async () => {
    process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = "*";
    const db = memorySyncDb();
    const provider = {
      trackingApiForbidden: () => true,
      downloadLatestEvents: vi.fn(async () => ({
        articles: [],
        hardFailure: undefined,
        emptyNoContent: false,
        httpStatus: 200,
      })),
    };
    await runOrganizationEventDownloadSync(db.client as never, {
      organizationId: "11111111-1111-4111-8111-111111111111",
      provider: provider as never,
      bulkCustomerId: "1000002954",
      mode: "overlap",
      hasStoredEvents: true,
    });
    expect(db.lookbacks.size).toBe(0);
    expect([...db.checkpoints.values()].some((row) => row.last_success_at)).toBe(true);
    expect(shouldRunHistoricalLookback(null)).toBe(true);
  });
});

describe("TNT01/TNT02 sync before Event Download", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const shipment = {
    id: "s1",
    barcode: "CX075364450IN",
    status: "IN_TRANSIT",
    order_id: null,
    operational_status: null,
    last_event_at: null,
    last_tracked_at: null,
    ndr_attempt_count: 0,
    rto_initiated_at: null,
  };
  const accepted = {
    articles: [],
    chunkOutcomes: ["SUCCESS_WITH_EMPTY_HISTORY"],
    batchesAttempted: 1,
    batchesSucceeded: 1,
    batchesFailed: 0,
    emptyNoContent: true,
    httpStatus: 200,
    forbidden: false,
  };

  afterEach(() => {
    if (previousAllowlist == null) delete process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST;
    else process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = previousAllowlist;
  });

  it("uses the tracking API without the Event Download allowlist", async () => {
    process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = "";
    const provider = {
      trackingApiForbidden: () => false,
      trackViaTrackingApi: vi.fn(async () => accepted),
      downloadLatestEvents: vi.fn(),
    };
    const result = await runOrganizationEventDownloadSync(memorySyncDb([shipment]).client as never, {
      organizationId,
      provider: provider as never,
      bulkCustomerId: "1000002954",
      mode: "overlap",
    });
    expect(provider.trackViaTrackingApi).toHaveBeenCalledWith(["CX075364450IN"]);
    expect(provider.downloadLatestEvents).not.toHaveBeenCalled();
    expect(result.trackingSource).toBe("tracking-api");
    expect(result.liveTracking).toBe("ok");
    expect(result.availability).toBe("TRACKING_NO_SCANS_YET");
  });

  it("skips shipments tracked inside the cooldown", async () => {
    const provider = {
      trackingApiForbidden: () => false,
      trackViaTrackingApi: vi.fn(async () => accepted),
      downloadLatestEvents: vi.fn(),
    };
    const result = await runOrganizationEventDownloadSync(
      memorySyncDb([{ ...shipment, last_tracked_at: new Date().toISOString() }]).client as never,
      { organizationId, provider: provider as never, bulkCustomerId: "1000002954", mode: "overlap", cooldownMs: 60_000 }
    );
    expect(provider.trackViaTrackingApi).not.toHaveBeenCalled();
    expect(result.skippedFetch).toBe(true);
  });

  it("falls back to Event Download when the tracking API is forbidden", async () => {
    process.env.INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST = "*";
    const provider = {
      trackingApiForbidden: () => false,
      trackViaTrackingApi: vi.fn(async () => ({ ...accepted, batchesSucceeded: 0, forbidden: true })),
      downloadLatestEvents: vi.fn(async () => ({ articles: [], emptyNoContent: false, httpStatus: 200 })),
    };
    const result = await runOrganizationEventDownloadSync(memorySyncDb([shipment]).client as never, {
      organizationId,
      provider: provider as never,
      bulkCustomerId: "1000002954",
      mode: "overlap",
    });
    expect(provider.downloadLatestEvents).toHaveBeenCalled();
    expect(result.trackingSource).toBe("event-download");
  });
});

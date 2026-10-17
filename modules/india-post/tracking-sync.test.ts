import { describe, expect, it, vi } from "vitest";
import { INDIA_POST_TRACKING_BULK_LIMIT } from "@/modules/india-post/spec";
import {
  enqueueDueTrackingSyncJobs,
  enqueueOrgTrackingSyncIfIdle,
  trackingSyncDueFilter,
  trackingSyncPageSize,
  trackingSyncUnscannedIntervalMs,
} from "@/modules/india-post/tracking-sync";

vi.mock("@/modules/jobs/service", () => ({
  createBackgroundJob: vi.fn(async () => ({ id: "job-1" })),
}));

describe("tracking-sync enqueue", () => {
  it("caps page size at the CEPT bulk tracking limit of 500", () => {
    expect(INDIA_POST_TRACKING_BULK_LIMIT).toBe(500);
    expect(trackingSyncPageSize()).toBeLessThanOrEqual(500);
  });

  it("skips an organization that already has an open tracking-sync job", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    vi.mocked(createBackgroundJob).mockClear();
    const jobsApi: Record<string, unknown> = {};
    jobsApi.select = () => jobsApi;
    jobsApi.eq = () => jobsApi;
    jobsApi.in = () => jobsApi;
    jobsApi.limit = async () => ({ data: [{ id: "open" }], error: null });
    const supabase = {
      from() {
        return jobsApi;
      },
    };
    const result = await enqueueOrgTrackingSyncIfIdle(supabase as never, "org-1");
    expect(result).toEqual({ enqueued: false, reason: "open-job" });
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("queues at most the configured number of idle connected orgs", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    vi.mocked(createBackgroundJob).mockClear();
    const supabase = {
      from(table: string) {
        return {
          select() {
            return {
              eq(column: string) {
                if (table === "automation_settings") {
                  return {
                    limit: async () => ({
                      data: [{ organization_id: "org-1" }, { organization_id: "org-2" }],
                      error: null,
                    }),
                  };
                }
                if (table === "india_post_connections") {
                  return {
                    maybeSingle: async () => ({
                      data: { id: "c1", status: "CONNECTED", encrypted_username: "x" },
                      error: null,
                    }),
                  };
                }
                if (table === "background_jobs" && column === "organization_id") {
                  return {
                    eq() {
                      return {
                        in() {
                          return {
                            limit: async () => ({ data: [], error: null }),
                          };
                        },
                      };
                    },
                  };
                }
                return {
                  eq() {
                    return {
                      in() {
                        return { limit: async () => ({ data: [], error: null }) };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    const result = await enqueueDueTrackingSyncJobs(supabase as never);
    expect(result.enqueued).toBe(2);
    expect(createBackgroundJob).toHaveBeenCalledTimes(2);
  });
});

describe("tracking-sync due filter", () => {
  it("re-polls articles with no scans sooner than the normal interval", () => {
    const now = Date.parse("2026-10-17T12:00:00.000Z");
    expect(trackingSyncUnscannedIntervalMs()).toBe(2 * 60 * 1000);
    expect(trackingSyncDueFilter(now)).toContain("last_event_at.is.null");
    expect(trackingSyncDueFilter(now)).toContain("2026-10-17T11:58:00.000Z");
    expect(trackingSyncDueFilter(now)).toContain("2026-10-17T11:45:00.000Z");
  });
});

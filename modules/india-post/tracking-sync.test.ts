import { describe, expect, it, vi } from "vitest";
import { INDIA_POST_TRACKING_BULK_LIMIT } from "@/modules/india-post/spec";
import {
  enqueueDueTrackingSyncJobs,
  enqueueOrgTrackingSyncIfIdle,
  trackingSyncPageSize,
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
    const jobs = {
      select() {
        return jobs;
      },
      eq() {
        return jobs;
      },
      in() {
        return jobs;
      },
      gte() {
        return jobs;
      },
      limit: async () => ({ data: [], error: null }),
    };
    const shipments = {
      eq() {
        return shipments;
      },
      not() {
        return shipments;
      },
      in() {
        return shipments;
      },
      or() {
        return shipments;
      },
      then(resolve: (value: { count: number; error: null }) => void) {
        resolve({ count: 1, error: null });
      },
    };
    const supabase = {
      from(table: string) {
        if (table === "automation_settings") {
          return {
            select() {
              return {
                eq() {
                  return {
                    limit: async () => ({
                      data: [{ organization_id: "org-1" }, { organization_id: "org-2" }],
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        if (table === "india_post_connections") {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: async () => ({
                      data: { id: "c1", status: "CONNECTED", encrypted_username: "x" },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        }
        if (table === "shipments") {
          return {
            select() {
              return shipments;
            },
          };
        }
        return jobs;
      },
    };
    const result = await enqueueDueTrackingSyncJobs(supabase as never);
    expect(result.enqueued).toBe(2);
    expect(createBackgroundJob).toHaveBeenCalledTimes(2);
  });

  it("does not requeue an organization in authentication cooldown", async () => {
    const { createBackgroundJob } = await import("@/modules/jobs/service");
    vi.mocked(createBackgroundJob).mockClear();
    let jobQuery = 0;
    const jobs = {
      select() {
        return jobs;
      },
      eq() {
        return jobs;
      },
      in() {
        return jobs;
      },
      gte() {
        return jobs;
      },
      async limit() {
        jobQuery += 1;
        if (jobQuery === 1) return { data: [], error: null };
        return { data: [{ id: "failed-auth" }], error: null };
      },
    };
    const result = await enqueueOrgTrackingSyncIfIdle(
      {
        from() {
          return jobs;
        },
      } as never,
      "org-auth"
    );
    expect(result).toEqual({ enqueued: false, reason: "auth-cooldown" });
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });
});

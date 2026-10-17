import { describe, expect, it, vi } from "vitest";
import {
  cooldownMsForAuthStrikes,
  decideTrackingAuthHold,
  evaluateTrackingAuthHold,
  TRACKING_AUTH_HOLD_DELAYS_MS,
} from "@/modules/india-post/tracking-auth-hold";
import { createBackgroundJob } from "@/modules/jobs/service";
import { enqueueDueTrackingSyncJobs, enqueueOrgTrackingSyncIfIdle } from "@/modules/india-post/tracking-sync";

vi.mock("@/modules/jobs/service", () => ({
  createBackgroundJob: vi.fn(async () => ({ id: "job-1" })),
}));

type JobRow = {
  id: string;
  organization_id: string;
  job_type: string;
  status: string;
  created_at: string;
  last_error_code?: string | null;
  last_error?: string | null;
};

function jobsQuery(rows: JobRow[]) {
  let filtered = [...rows];
  let limitCount = 50;
  let pendingPatch: Record<string, unknown> | null = null;
  const api: Record<string, unknown> = {};
  const commit = () => {
    if (pendingPatch) {
      for (const row of filtered) Object.assign(row, pendingPatch);
      pendingPatch = null;
    }
    return { data: filtered.slice(0, limitCount), error: null };
  };
  api.select = () => api;
  api.eq = (column: string, value: string) => {
    filtered = filtered.filter((row) => String((row as Record<string, unknown>)[column] ?? "") === value);
    return api;
  };
  api.in = (column: string, values: string[]) => {
    filtered = filtered.filter((row) => values.includes(String((row as Record<string, unknown>)[column] ?? "")));
    return api;
  };
  api.gt = (column: string, value: string) => {
    filtered = filtered.filter((row) => String((row as Record<string, unknown>)[column] ?? "") > value);
    return api;
  };
  api.order = (column: string, opts?: { ascending?: boolean }) => {
    const asc = Boolean(opts?.ascending);
    filtered = [...filtered].sort((a, b) => {
      const left = String((a as Record<string, unknown>)[column] ?? "");
      const right = String((b as Record<string, unknown>)[column] ?? "");
      return asc ? left.localeCompare(right) : right.localeCompare(left);
    });
    return api;
  };
  api.limit = (count: number) => {
    limitCount = count;
    return Promise.resolve(commit());
  };
  api.update = (patch: Record<string, unknown>) => {
    pendingPatch = patch;
    return api;
  };
  api.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(commit()).then(resolve, reject);
  return api;
}

function enqueueClient(input: {
  orgIds?: string[];
  connections?: Record<string, Record<string, unknown>>;
  jobs?: JobRow[];
}) {
  return {
    from(table: string) {
      if (table === "automation_settings") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: (input.orgIds ?? ["org-a"]).map((organization_id) => ({ organization_id })),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "india_post_connections") {
        let organizationId = "";
        return {
          select: () => ({
            eq: (_column: string, value: string) => {
              organizationId = value;
              return {
                maybeSingle: async () => ({
                  data: input.connections?.[organizationId] ?? {
                    id: "c1",
                    status: "CONNECTED",
                    encrypted_username: "x",
                    last_verified_at: null,
                    last_refreshed_at: null,
                  },
                  error: null,
                }),
              };
            },
          }),
        };
      }
      return jobsQuery(input.jobs ?? []);
    },
  };
}

const authFail = (org: string, createdAt: string, id = "fail-1"): JobRow => ({
  id,
  organization_id: org,
  job_type: "tracking-sync",
  status: "FAILED",
  created_at: createdAt,
  last_error_code: "HTTP_400",
  last_error: "India Post authentication failed.",
});

describe("tracking authentication hold", () => {
  it("uses bounded cooldowns that cap at 24 hours", () => {
    expect(cooldownMsForAuthStrikes(1)).toBe(TRACKING_AUTH_HOLD_DELAYS_MS[0]);
    expect(cooldownMsForAuthStrikes(2)).toBe(TRACKING_AUTH_HOLD_DELAYS_MS[1]);
    expect(cooldownMsForAuthStrikes(5)).toBe(TRACKING_AUTH_HOLD_DELAYS_MS[4]);
    expect(cooldownMsForAuthStrikes(9)).toBe(TRACKING_AUTH_HOLD_DELAYS_MS[4]);
  });

  it("holds after a confirmed login authentication failure", () => {
    const now = Date.parse("2026-10-17T12:14:00.000Z");
    const decision = decideTrackingAuthHold({
      now,
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
    });
    expect(decision).toMatchObject({ blocked: true, reason: "auth-hold", strikeCount: 1 });
  });

  it("allows a single recovery probe after cooldown expiry", () => {
    const now = Date.parse("2026-10-17T12:20:00.000Z");
    const decision = decideTrackingAuthHold({
      now,
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
    });
    expect(decision).toMatchObject({ blocked: false, reason: "probe", strikeCount: 1 });
  });

  it("clears the hold when a later successful authentication marker exists", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:05:00.000Z"),
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
      lastVerifiedAt: "2026-10-17T12:04:00.000Z",
    });
    expect(decision).toMatchObject({ blocked: false, reason: "idle", strikeCount: 0 });
  });

  it("does not treat a later no-work SUCCEEDED tracking-sync as authentication recovery", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:05:00.000Z"),
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
      lastVerifiedAt: "2026-10-17T11:00:00.000Z",
      lastRefreshedAt: "2026-10-17T11:00:00.000Z",
    });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe("auth-hold");
  });

  it("clears the hold only after last_refreshed_at from a real token persist", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:05:00.000Z"),
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
      lastRefreshedAt: "2026-10-17T12:03:00.000Z",
    });
    expect(decision).toMatchObject({ blocked: false, reason: "idle", strikeCount: 0 });
  });

  it("renews cooldown from consecutive durable auth failures", () => {
    const now = Date.parse("2026-10-17T12:20:00.000Z");
    const decision = decideTrackingAuthHold({
      now,
      failuresNewestFirst: [
        authFail("org-a", "2026-10-17T12:16:00.000Z", "fail-2"),
        authFail("org-a", "2026-10-17T12:00:00.000Z", "fail-1"),
      ],
    });
    expect(decision.blocked).toBe(true);
    expect(decision.strikeCount).toBe(2);
    expect(decision.reason).toBe("auth-hold");
  });

  it("keeps the auth hold when a later non-auth tracking-sync failure is newest", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:05:00.000Z"),
      failuresNewestFirst: [
        {
          ...authFail("org-a", "2026-10-17T12:04:00.000Z"),
          last_error_code: "HTTP_500",
          last_error: "unavailable",
        },
        authFail("org-a", "2026-10-17T12:00:00.000Z"),
      ],
    });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe("auth-hold");
  });

  it("throttles another probe after a no-work SUCCEEDED recovery job", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:20:00.000Z"),
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
      lastProbeAt: "2026-10-17T12:16:00.000Z",
    });
    expect(decision.blocked).toBe(true);
    expect(decision.reason).toBe("probe-throttle");
  });

  it("lets verified token persist supersede a no-work probe throttle", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:20:00.000Z"),
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
      lastProbeAt: "2026-10-17T12:16:00.000Z",
      lastRefreshedAt: "2026-10-17T12:18:00.000Z",
    });
    expect(decision).toMatchObject({ blocked: false, reason: "idle" });
  });

  it("allows a later probe after the no-work throttle window", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:32:00.000Z"),
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
      lastProbeAt: "2026-10-17T12:16:00.000Z",
    });
    expect(decision).toMatchObject({ blocked: false, reason: "probe" });
  });

  it("does not enqueue a second probe on the next cron after a no-work success", async () => {
    vi.mocked(createBackgroundJob).mockClear();
    const failAt = new Date(Date.now() - 20 * 60_000).toISOString();
    const probeAt = new Date(Date.now() - 60_000).toISOString();
    const client = enqueueClient({
      orgIds: ["org-a"],
      jobs: [
        authFail("org-a", failAt),
        {
          id: "no-work",
          organization_id: "org-a",
          job_type: "tracking-sync",
          status: "SUCCEEDED",
          created_at: probeAt,
        },
      ],
    });
    await enqueueDueTrackingSyncJobs(client as never);
    await enqueueDueTrackingSyncJobs(client as never);
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("does not let another organization's success clear a hold", async () => {
    const nowIso = "2026-10-17T12:00:00.000Z";
    const decision = await evaluateTrackingAuthHold(
      enqueueClient({
        jobs: [
          authFail("org-a", nowIso),
          {
            id: "ok-b",
            organization_id: "org-b",
            job_type: "tracking-sync",
            status: "SUCCEEDED",
            created_at: "2026-10-17T12:10:00.000Z",
          },
        ],
      }) as never,
      { organizationId: "org-a", now: Date.parse("2026-10-17T12:05:00.000Z") }
    );
    expect(decision.blocked).toBe(true);
  });

  it("skips enqueue for a held organization while enqueueing a neighbor", async () => {
    vi.mocked(createBackgroundJob).mockClear();
    const now = new Date().toISOString();
    const result = await enqueueDueTrackingSyncJobs(
      enqueueClient({
        orgIds: ["org-a", "org-b"],
        jobs: [authFail("org-a", now)],
      }) as never
    );
    expect(result.enqueued).toBe(1);
    expect(createBackgroundJob).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createBackgroundJob).mock.calls[0][1].organizationId).toBe("org-b");
  });

  it("does not enqueue repeatedly while cooldown is active", async () => {
    vi.mocked(createBackgroundJob).mockClear();
    const client = enqueueClient({
      orgIds: ["org-a"],
      jobs: [authFail("org-a", new Date().toISOString())],
    });
    await enqueueDueTrackingSyncJobs(client as never);
    await enqueueDueTrackingSyncJobs(client as never);
    await enqueueDueTrackingSyncJobs(client as never);
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("allows a recovery probe after cooldown and still dedupes an open job", async () => {
    vi.mocked(createBackgroundJob).mockClear();
    const expired = new Date(Date.now() - 20 * 60_000).toISOString();
    const idle = await enqueueOrgTrackingSyncIfIdle(
      enqueueClient({ jobs: [authFail("org-a", expired)] }) as never,
      "org-a"
    );
    expect(idle.reason).toBe("probe");
    expect(createBackgroundJob).toHaveBeenCalledTimes(1);

    vi.mocked(createBackgroundJob).mockClear();
    const open = await enqueueOrgTrackingSyncIfIdle(
      enqueueClient({
        jobs: [
          authFail("org-a", expired),
          {
            id: "open",
            organization_id: "org-a",
            job_type: "tracking-sync",
            status: "QUEUED",
            created_at: new Date().toISOString(),
          },
        ],
      }) as never,
      "org-a"
    );
    expect(open).toEqual({ enqueued: false, reason: "open-job" });
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("does not treat a failed credential save as recovery", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:05:00.000Z"),
      failuresNewestFirst: [authFail("org-a", "2026-10-17T12:00:00.000Z")],
      lastVerifiedAt: "2026-10-17T11:00:00.000Z",
      lastRefreshedAt: "2026-10-17T11:00:00.000Z",
    });
    expect(decision.blocked).toBe(true);
  });

  it("caps strike count using the bounded 10-row history at 24h", () => {
    const newest = Date.parse("2026-10-17T12:00:00.000Z");
    const failures = Array.from({ length: 11 }, (_, index) =>
      authFail("org-a", new Date(newest - index * 60_000).toISOString(), `fail-${index}`)
    );
    const decision = decideTrackingAuthHold({
      now: newest + 60_000,
      failuresNewestFirst: failures.slice(0, 10),
    });
    expect(decision.strikeCount).toBe(10);
    expect(decision.blocked).toBe(true);
  });

  it("does not hold when FAILED auth history is missing", () => {
    const decision = decideTrackingAuthHold({
      now: Date.parse("2026-10-17T12:00:00.000Z"),
      failuresNewestFirst: [],
    });
    expect(decision).toMatchObject({ blocked: false, reason: "idle" });
  });

  it("ignores unrelated job types when deciding a hold", async () => {
    const decision = await evaluateTrackingAuthHold(
      enqueueClient({
        jobs: [
          {
            id: "booking",
            organization_id: "org-a",
            job_type: "shipment-booking",
            status: "FAILED",
            created_at: new Date().toISOString(),
            last_error_code: "HTTP_400",
            last_error: "India Post authentication failed.",
          },
        ],
      }) as never,
      { organizationId: "org-a" }
    );
    expect(decision.blocked).toBe(false);
  });

  it("cancels newer duplicate queued probes after a check-then-insert race", async () => {
    const expired = new Date(Date.now() - 20 * 60_000).toISOString();
    const jobs: JobRow[] = [authFail("org-a", expired)];
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(createBackgroundJob).mockImplementation(async (_supabase, input) => {
      started += 1;
      if (started === 2) release();
      await bothStarted;
      const row: JobRow = {
        id: `probe-${started}-${Math.random().toString(16).slice(2)}`,
        organization_id: input.organizationId,
        job_type: "tracking-sync",
        status: "QUEUED",
        created_at: new Date(Date.now() + started).toISOString(),
      };
      jobs.push(row);
      return { id: row.id };
    });
    const client = enqueueClient({ jobs });
    await Promise.all([
      enqueueOrgTrackingSyncIfIdle(client as never, "org-a"),
      enqueueOrgTrackingSyncIfIdle(client as never, "org-a"),
    ]);
    const queued = jobs.filter((row) => row.status === "QUEUED" && row.job_type === "tracking-sync");
    const cancelled = jobs.filter((row) => row.status === "CANCELLED");
    expect(queued).toHaveLength(1);
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
  });
});

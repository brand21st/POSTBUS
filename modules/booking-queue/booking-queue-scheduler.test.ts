import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  automaticRunDue,
  MAX_RUNS_PER_TICK,
  nextAutomaticTimeout,
  planAutomaticRuns,
  tickLimits,
  type ReadyItem,
} from "@/modules/booking-queue/planner";
import { nextBatchText } from "@/components/booking-queue/view";

const createBackgroundJob = vi.fn();
const startBookingJobs = vi.fn();
const checkQuota = vi.fn();

vi.mock("@/modules/jobs/service", () => ({ createBackgroundJob: (...args: unknown[]) => createBackgroundJob(...args) }));
vi.mock("@/modules/booking-queue/actions", () => ({ startBookingJobs: (...args: unknown[]) => startBookingJobs(...args) }));
vi.mock("@/modules/billing/usage", () => ({ checkQuota: (...args: unknown[]) => checkQuota(...args) }));

const { AUTO_HOLD_AFTER_ERRORS, enqueueDueBookingQueueDispatches, runAutomaticDispatch } = await import(
  "@/modules/booking-queue/scheduler"
);
const { rollUpRun, runAttentionNotice } = await import("@/modules/booking-queue/service");

const NOW = new Date("2026-11-02T10:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
function ready(count: number, oldestMinutesAgo = 1, prefix = "i"): ReadyItem[] {
  // Oldest first, one second apart.
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${String(index).padStart(5, "0")}`,
    readyAt: new Date(NOW.getTime() - oldestMinutesAgo * 60_000 + index * 1000).toISOString(),
  }));
}

describe("planning automatic batches", () => {
  it("TEST 3: starts one batch when the threshold is reached", () => {
    const runs = planAutomaticRuns(ready(50), { threshold: 50, maxWaitMinutes: 30, now: NOW });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: "AUTO_THRESHOLD" });
    expect(runs[0].itemIds).toHaveLength(50);
  });

  it("TEST 4: 120 ready with threshold 50 makes two batches and leaves the newest 20 waiting", () => {
    const items = ready(120);
    const runs = planAutomaticRuns(items, { threshold: 50, maxWaitMinutes: 30, now: NOW });
    expect(runs.map((run) => [run.trigger, run.itemIds.length])).toEqual([
      ["AUTO_THRESHOLD", 50],
      ["AUTO_THRESHOLD", 50],
    ]);
    expect(runs[0].itemIds[0]).toBe(items[0].id);
    const planned = new Set(runs.flatMap((run) => run.itemIds));
    expect(items.filter((item) => !planned.has(item.id)).map((item) => item.id)).toEqual(items.slice(100).map((item) => item.id));
  });

  it("TEST 5: a small group goes once its oldest order has waited the maximum time", () => {
    expect(planAutomaticRuns(ready(20, 29), { threshold: 50, maxWaitMinutes: 30, now: NOW })).toEqual([]);
    const runs = planAutomaticRuns(ready(20, 31), { threshold: 50, maxWaitMinutes: 30, now: NOW });
    expect(runs).toEqual([{ trigger: "AUTO_TIMEOUT", itemIds: ready(20, 31).map((item) => item.id) }]);
  });

  it("does not reset the clock when new orders arrive", () => {
    // Oldest waited 31 minutes; 15 more arrived a minute ago. All 35 go on time.
    const items = [...ready(20, 31, "old"), ...ready(15, 1, "new")];
    const runs = planAutomaticRuns(items, { threshold: 50, maxWaitMinutes: 30, now: NOW });
    expect(runs).toHaveLength(1);
    expect(runs[0].itemIds).toHaveLength(35);
  });

  it("never times out without a maximum wait, and never mixes a timeout into a full batch", () => {
    expect(planAutomaticRuns(ready(20, 600), { threshold: 50, maxWaitMinutes: null, now: NOW })).toEqual([]);
    const runs = planAutomaticRuns(ready(70, 60), { threshold: 50, maxWaitMinutes: 30, now: NOW });
    expect(runs.map((run) => [run.trigger, run.itemIds.length])).toEqual([
      ["AUTO_THRESHOLD", 50],
      ["AUTO_TIMEOUT", 20],
    ]);
  });

  it("TEST 17 and 18: a logical batch of 5000 is one run; the transport stays one article per request", () => {
    const runs = planAutomaticRuns(ready(5000), { threshold: 5000, maxWaitMinutes: 30, now: NOW });
    expect(runs).toHaveLength(1);
    expect(runs[0].itemIds).toHaveLength(5000);
    expect(tickLimits(5000)).toEqual({ runs: 1, items: 5000 });
  });

  it("bounds the work of one tick", () => {
    expect(tickLimits(1)).toEqual({ runs: MAX_RUNS_PER_TICK, items: MAX_RUNS_PER_TICK });
    expect(tickLimits(1000)).toEqual({ runs: 5, items: 5000 });
    expect(planAutomaticRuns(ready(40), { threshold: 1, maxWaitMinutes: 30, now: NOW })).toHaveLength(MAX_RUNS_PER_TICK);
  });

  it("answers the scan's due question and the next timeout from stored times", () => {
    const base = { threshold: 50, maxWaitMinutes: 30, now: NOW };
    expect(automaticRunDue({ ...base, readyCount: 0, oldestReadyAt: null })).toBe(false);
    expect(automaticRunDue({ ...base, readyCount: 50, oldestReadyAt: minutesAgo(1) })).toBe(true);
    expect(automaticRunDue({ ...base, readyCount: 3, oldestReadyAt: minutesAgo(29) })).toBe(false);
    expect(automaticRunDue({ ...base, readyCount: 3, oldestReadyAt: minutesAgo(30) })).toBe(true);
    expect(nextAutomaticTimeout(minutesAgo(10), 30)).toBe(new Date(NOW.getTime() + 20 * 60_000).toISOString());
    expect(nextAutomaticTimeout(null, 30)).toBeNull();
    expect(nextAutomaticTimeout(minutesAgo(10), null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Scheduler scan and dispatch job against an in-memory client.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function memory(tables: Record<string, Row[]>, rpc?: (...args: unknown[]) => unknown) {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "update" | "insert" = "select";
    let payload: Row | null = null;
    let head = false;
    let limit = Infinity;
    let orderBy: string | null = null;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (op === "insert") {
        rows().push({ ...payload! });
        return { data: [payload], error: null, count: null };
      }
      let matched = rows().filter((row) => filters.every((test) => test(row)));
      if (orderBy) matched = [...matched].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      matched = matched.slice(0, limit);
      if (op === "update") for (const row of matched) Object.assign(row, payload);
      return { data: head ? null : matched, error: null, count: matched.length };
    };
    const builder: Record<string, unknown> = {
      select: (_columns?: string, options?: { head?: boolean }) => ((head = Boolean(options?.head)), builder),
      update: (value: Row) => ((op = "update"), (payload = value), builder),
      insert: (value: Row) => ((op = "insert"), (payload = value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      order: (column: string) => ((orderBy = column), builder),
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: null };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  return { from, rpc } as unknown as SupabaseClient;
}

function settings(org: string, overrides: Row = {}): Row {
  return {
    organization_id: org,
    mode: "AUTOMATIC",
    paused_at: null,
    batch_threshold: 50,
    max_wait_minutes: 30,
    auto_hold_until: null,
    version: 3,
    consecutive_errors: 0,
    ...overrides,
  };
}

function readyRows(org: string, count: number, oldestMinutesAgo = 1) {
  return ready(count, oldestMinutesAgo, `${org}-`).map((item) => ({
    id: item.id,
    organization_id: org,
    state: "READY_FOR_BOOKING",
    ready_at: item.readyAt,
  }));
}

const FLAGS = { queue: process.env.BOOKING_QUEUE_ORGS, automation: process.env.BOOKING_QUEUE_AUTOMATION_ORGS };

beforeEach(() => {
  process.env.BOOKING_QUEUE_ORGS = "*";
  process.env.BOOKING_QUEUE_AUTOMATION_ORGS = "org-a,org-b,org-c,org-d";
  createBackgroundJob.mockReset();
  startBookingJobs.mockReset();
  checkQuota.mockReset();
});

afterEach(() => {
  process.env.BOOKING_QUEUE_ORGS = FLAGS.queue;
  process.env.BOOKING_QUEUE_AUTOMATION_ORGS = FLAGS.automation;
});

describe("scheduler scan", () => {
  it("queues one dispatch job per due workspace and nothing for the rest", async () => {
    const tables: Record<string, Row[]> = {
      booking_automation_settings: [
        settings("org-a"), // 60 ready -> due
        settings("org-b"), // 5 ready, fresh -> not due
        settings("org-c", { paused_at: minutesAgo(5) }), // paused
        settings("org-d", { auto_hold_until: new Date(NOW.getTime() + 60_000).toISOString() }), // on hold
        settings("org-x"), // outside the automation rollout
        settings("org-m", { mode: "MANUAL" }),
      ],
      booking_queue_items: [
        ...readyRows("org-a", 60),
        ...readyRows("org-b", 5),
        ...readyRows("org-c", 60),
        ...readyRows("org-d", 60),
        ...readyRows("org-x", 60),
        ...readyRows("org-m", 60),
      ],
      background_jobs: [],
    };
    const result = await enqueueDueBookingQueueDispatches(memory(tables), NOW);
    expect(result).toEqual({ candidates: 2, due: 1, enqueued: 1 });
    expect(createBackgroundJob).toHaveBeenCalledTimes(1);
    expect(createBackgroundJob.mock.calls[0][1]).toEqual({
      organizationId: "org-a",
      jobType: "booking-queue-dispatch",
      entityType: "organization",
      entityId: "org-a",
    });
  });

  it("does not queue a second dispatch job while one is active", async () => {
    const tables: Record<string, Row[]> = {
      booking_automation_settings: [settings("org-a")],
      booking_queue_items: readyRows("org-a", 60),
      background_jobs: [{ id: "j1", organization_id: "org-a", job_type: "booking-queue-dispatch", status: "RUNNING" }],
    };
    expect(await enqueueDueBookingQueueDispatches(memory(tables), NOW)).toEqual({ candidates: 1, due: 1, enqueued: 0 });
    expect(createBackgroundJob).not.toHaveBeenCalled();
  });

  it("TEST 25: schedules nothing when automation is not rolled out", async () => {
    delete process.env.BOOKING_QUEUE_AUTOMATION_ORGS;
    const tables = { booking_automation_settings: [settings("org-a")], booking_queue_items: readyRows("org-a", 60), background_jobs: [] };
    expect(await enqueueDueBookingQueueDispatches(memory(tables), NOW)).toEqual({ candidates: 0, due: 0, enqueued: 0 });
  });
});

describe("automatic dispatch job", () => {
  function rpcReturning(results: Array<Record<string, unknown>>) {
    const rpc = vi.fn();
    for (const result of results) rpc.mockResolvedValueOnce({ data: result, error: null });
    return rpc;
  }

  it("dispatches planned runs with keys tied to the job, then starts their booking jobs", async () => {
    const rpc = rpcReturning([
      { runId: "run-1", replayed: false, dispatched: [{ jobId: "b1" }, { jobId: "b2" }], skipped: [] },
      { runId: "run-2", replayed: false, dispatched: [{ jobId: "b3" }], skipped: [] },
    ]);
    const tables: Record<string, Row[]> = {
      booking_automation_settings: [settings("org-a", { batch_threshold: 50, consecutive_errors: 2, last_error: "old" })],
      booking_queue_items: readyRows("org-a", 120),
    };
    const result = await runAutomaticDispatch(memory(tables, rpc), "org-a", "job-9", NOW);
    expect(result.runs.map((run) => run.trigger)).toEqual(["AUTO_THRESHOLD", "AUTO_THRESHOLD"]);
    expect(checkQuota).toHaveBeenCalledWith(expect.anything(), "org-a", 100);
    expect(rpc.mock.calls.map((call) => (call[1] as Row).p_idempotency_key)).toEqual(["auto-job-9-0", "auto-job-9-1"]);
    expect((rpc.mock.calls[0][1] as Row)).toMatchObject({ p_trigger: "AUTO_THRESHOLD", p_group_key: "AUTO", p_created_by: null, p_settings_version: 3 });
    expect(startBookingJobs.mock.calls.map((call) => call[2])).toEqual([["b1", "b2"], ["b3"]]);
    expect(tables.booking_automation_settings[0]).toMatchObject({ consecutive_errors: 0, last_error: null, last_dispatch_at: NOW.toISOString() });
  });

  it("TEST 6: does nothing when switched to manual or paused, and stops if paused mid-way", async () => {
    const rpc = vi.fn();
    for (const overrides of [{ mode: "MANUAL" }, { paused_at: minutesAgo(1) }]) {
      const tables = { booking_automation_settings: [settings("org-a", overrides)], booking_queue_items: readyRows("org-a", 60) };
      expect(await runAutomaticDispatch(memory(tables, rpc), "org-a", "job-1", NOW)).toEqual({ skipped: "NOT_AUTOMATIC", runs: [] });
    }
    expect(rpc).not.toHaveBeenCalled();

    const pausing = rpcReturning([{ runId: null, paused: true, dispatched: [], skipped: [] }]);
    const tables = { booking_automation_settings: [settings("org-a")], booking_queue_items: readyRows("org-a", 120) };
    const result = await runAutomaticDispatch(memory(tables, pausing), "org-a", "job-2", NOW);
    expect(pausing).toHaveBeenCalledTimes(1);
    expect(result.runs).toEqual([]);
    expect(startBookingJobs).not.toHaveBeenCalled();
  });

  it("does not start jobs again when a retried job replays its runs", async () => {
    const rpc = rpcReturning([{ runId: "run-1", replayed: true, dispatched: [{ jobId: "b1" }], skipped: [] }]);
    const tables = { booking_automation_settings: [settings("org-a")], booking_queue_items: readyRows("org-a", 50) };
    await runAutomaticDispatch(memory(tables, rpc), "org-a", "job-1", NOW);
    expect(startBookingJobs).not.toHaveBeenCalled();
  });

  it("holds itself after repeated failures and tells the merchant", async () => {
    const failing = vi.fn().mockResolvedValue({ data: null, error: { message: "database busy" } });
    const tables: Record<string, Row[]> = {
      booking_automation_settings: [settings("org-a", { consecutive_errors: AUTO_HOLD_AFTER_ERRORS - 1 })],
      booking_queue_items: readyRows("org-a", 50),
      notifications: [],
    };
    await expect(runAutomaticDispatch(memory(tables, failing), "org-a", "job-1", NOW)).rejects.toThrow("database busy");
    expect(tables.booking_automation_settings[0]).toMatchObject({
      consecutive_errors: AUTO_HOLD_AFTER_ERRORS,
      last_error: "database busy",
      auto_hold_reason: "database busy",
    });
    expect(Date.parse(String(tables.booking_automation_settings[0].auto_hold_until))).toBeGreaterThan(NOW.getTime());
    expect(tables.notifications[0]).toMatchObject({ organization_id: "org-a", title: "Automatic booking is on hold" });

    // While on hold the job does nothing.
    expect(await runAutomaticDispatch(memory(tables, failing), "org-a", "job-2", NOW)).toEqual({ skipped: "ON_HOLD", runs: [] });
  });

  it("counts a quota problem as a failure without dispatching", async () => {
    checkQuota.mockRejectedValue(new Error("Monthly shipment limit reached."));
    const rpc = vi.fn();
    const tables: Record<string, Row[]> = { booking_automation_settings: [settings("org-a")], booking_queue_items: readyRows("org-a", 50) };
    await expect(runAutomaticDispatch(memory(tables, rpc), "org-a", "job-1", NOW)).rejects.toThrow(/limit/);
    expect(rpc).not.toHaveBeenCalled();
    expect(tables.booking_automation_settings[0]).toMatchObject({ consecutive_errors: 1, last_error: "Monthly shipment limit reached." });
  });
});

describe("attention and status text", () => {
  it("notifies once when a run first needs a person", () => {
    expect(runAttentionNotice("ACTIVE", rollUpRun(["BOOKED", "RECOVERY_REQUIRED"]))?.title).toBe("Bulk Booking needs a check");
    expect(runAttentionNotice("ACTIVE", rollUpRun(["BOOKED", "FAILED"]))?.body).toBe("1 booked, 1 failed. Open Bulk Booking to see why.");
    expect(runAttentionNotice("COMPLETED_WITH_ERRORS", rollUpRun(["BOOKED", "FAILED"]))).toBeNull();
    expect(runAttentionNotice("ACTIVE", rollUpRun(["BOOKED", "BOOKED"]))).toBeNull();
  });

  it("describes the next automatic batch from stored values", () => {
    const base = { mode: "AUTOMATIC" as const, paused: false, batchThreshold: 50, formatTime: (iso: string) => iso.slice(11, 16) };
    expect(nextBatchText({ ...base, mode: "MANUAL", readyCount: 5, nextTimeout: null })).toBeNull();
    expect(nextBatchText({ ...base, paused: true, readyCount: 5, nextTimeout: null })).toBe("Automatic booking is paused.");
    expect(nextBatchText({ ...base, autoHoldUntil: "2026-11-02T10:15:00.000Z", readyCount: 5, nextTimeout: null })).toBe(
      "On hold after repeated failures until 10:15."
    );
    expect(nextBatchText({ ...base, readyCount: 0, nextTimeout: null })).toBe("Next batch starts when 50 orders are ready.");
    expect(nextBatchText({ ...base, readyCount: 12, nextTimeout: "2026-11-02T10:30:00.000Z" })).toBe(
      "Next batch at 50 ready orders, or by 10:30."
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORICAL_JOB_HOLD_AT } from "@/modules/india-post/smart-auto-retry";

const runIndiaPostBooking = vi.fn();
const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
let jobRow: Record<string, unknown> | null = null;

function chain(result: { data: unknown; error: null }) {
  const self: Record<string, unknown> = {};
  self.eq = () => self;
  self.in = () => self;
  self.select = () => self;
  self.maybeSingle = async () => result;
  self.single = async () => result;
  self.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return self;
}

vi.mock("@/modules/india-post/booking-run", () => ({
  runIndiaPostBooking: (...args: unknown[]) => runIndiaPostBooking(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      return {
        select() {
          return chain({ data: jobRow, error: null });
        },
        update(values: Record<string, unknown>) {
          updates.push({ table, values });
          return chain({
            data: { id: "job-parked", status: "QUEUED", next_attempt_at: HISTORICAL_JOB_HOLD_AT },
            error: null,
          });
        },
        insert() {
          return chain({ data: null, error: null });
        },
      };
    },
  }),
}));

describe("processJob parked historical booking", () => {
  beforeEach(() => {
    runIndiaPostBooking.mockReset();
    updates.length = 0;
    jobRow = {
      id: "job-parked",
      status: "RUNNING",
      next_attempt_at: HISTORICAL_JOB_HOLD_AT,
      attempt_count: 0,
      last_error_code: null,
      organization_id: "org-1",
    };
  });

  it("re-parks a RUNNING historical job and never books or marks SUCCEEDED", async () => {
    const { processJob } = await import("@/workers/processor");
    await processJob("shipment-booking", {
      organizationId: "org-1",
      jobId: "job-parked",
      entityType: "shipment",
      entityId: "ship-hist-1",
      attempt: 0,
    });
    expect(runIndiaPostBooking).not.toHaveBeenCalled();
    expect(updates.some((row) => row.values.status === "SUCCEEDED")).toBe(false);
    expect(updates.some((row) => row.values.status === "RUNNING" && row.values.started_at)).toBe(false);
    expect(updates).toEqual(
      expect.arrayContaining([
        {
          table: "background_jobs",
          values: {
            status: "QUEUED",
            locked_at: null,
            next_attempt_at: HISTORICAL_JOB_HOLD_AT,
          },
        },
      ])
    );
  }, 15_000);
});

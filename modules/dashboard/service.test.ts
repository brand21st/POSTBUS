import { describe, expect, it } from "vitest";
import {
  kpisFromWindows,
  pipelineFromStatusCounts,
  previousWindow,
  type KpiWindowCounts,
} from "@/modules/dashboard/service";

const current: KpiWindowCounts = {
  orders: 20,
  ready: 5,
  booked: 8,
  inTransit: 3,
  delivered: 4,
  failed: 1,
};

const prior: KpiWindowCounts = {
  orders: 10,
  ready: 2,
  booked: 4,
  inTransit: 2,
  delivered: 2,
  failed: 2,
};

describe("dashboard KPI windows", () => {
  it("computes the previous period of equal duration", () => {
    expect(previousWindow("2026-09-01", "2026-09-30")).toEqual({
      from: "2026-08-02",
      to: "2026-08-31",
    });
  });

  it("preserves current/previous counts and percent change", () => {
    const kpis = kpisFromWindows(current, prior);
    expect(kpis.orders.value).toBe(20);
    expect(kpis.orders.previous).toBe(10);
    expect(kpis.orders.change).toBe(100);
    expect(kpis.readyToShip.value).toBe(5);
    expect(kpis.ready.value).toBe(5);
    expect(kpis.booked.value).toBe(8);
    expect(kpis.inTransit.value).toBe(3);
    expect(kpis.delivered.value).toBe(4);
    expect(kpis.failed.value).toBe(1);
    expect(kpis.failed.change).toBe(-50);
  });

  it("maps pipeline totals for every stage", () => {
    const pipeline = pipelineFromStatusCounts({ READY: 4, DELIVERED: 2 });
    expect(pipeline.stages).toHaveLength(7);
    expect(pipeline.stages.find((s) => s.key === "READY")?.count).toBe(4);
    expect(pipeline.stages.find((s) => s.key === "IMPORTED")?.count).toBe(0);
    expect(pipeline.stages.find((s) => s.key === "DELIVERED")?.count).toBe(2);
  });
});

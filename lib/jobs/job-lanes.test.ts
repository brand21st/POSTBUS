import { describe, expect, it } from "vitest";
import {
  OTHER_JOB_TYPES,
  parseJobTypes,
  restDrainConcurrency,
  drainLaneName,
} from "@/lib/jobs/job-lanes";

describe("parseJobTypes", () => {
  it("returns undefined for empty input", () => {
    expect(parseJobTypes(null)).toBeUndefined();
    expect(parseJobTypes("")).toBeUndefined();
    expect(parseJobTypes("  , ")).toBeUndefined();
  });

  it("parses a comma list of known types", () => {
    expect(parseJobTypes("label-generation, shipment-booking")).toEqual([
      "label-generation",
      "shipment-booking",
    ]);
  });

  it("rejects unknown types", () => {
    expect(() => parseJobTypes("label-generation,not-a-job")).toThrow("Unknown job type: not-a-job");
  });
});

describe("drain lanes", () => {
  it("names booking, label, other, and all", () => {
    expect(drainLaneName()).toBe("all");
    expect(drainLaneName(["shipment-booking"])).toBe("booking");
    expect(drainLaneName(["label-generation"])).toBe("label");
    expect(drainLaneName(OTHER_JOB_TYPES)).toBe("other");
  });

  it("uses concurrency 4 when no bookings are in the batch", () => {
    expect(restDrainConcurrency(0)).toBe(4);
    expect(restDrainConcurrency(2)).toBe(2);
  });
});

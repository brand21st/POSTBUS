import { describe, expect, it } from "vitest";
import {
  OTHER_JOB_TYPES,
  parseJobTypes,
  restDrainConcurrency,
  drainLaneName,
  wooCommerceDrainPlan,
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

  it("includes support-ingest in the other drain lane", () => {
    expect(OTHER_JOB_TYPES).toContain("support-ingest");
    expect(OTHER_JOB_TYPES).toContain("woocommerce-sync");
    expect(OTHER_JOB_TYPES).toContain("woocommerce-tracking");
    expect(OTHER_JOB_TYPES).toContain("bulk-excel-import");
    expect(parseJobTypes("support-ingest")).toEqual(["support-ingest"]);
    expect(drainLaneName(["support-ingest"])).toBe("other");
    expect(drainLaneName(["bulk-excel-import"])).toBe("other");
  });

  it("keeps accounting jobs off the booking lane", () => {
    expect(OTHER_JOB_TYPES).toContain("cod-report-extract");
    expect(OTHER_JOB_TYPES).toContain("gst-draft");
    expect(drainLaneName(["cod-report-extract"])).toBe("other");
  });

  it("runs WooCommerce beside the other lane and keeps it off the oldest-first claim", () => {
    expect(wooCommerceDrainPlan(["tracking-sync", "shopify-sync", "woocommerce-sync"])).toEqual({
      primary: ["tracking-sync", "shopify-sync"],
      skipPrimary: false,
      woo: true,
    });
    expect(wooCommerceDrainPlan(["tracking-sync"]).woo).toBe(true);
    expect(wooCommerceDrainPlan(["label-generation"])).toEqual({
      primary: ["label-generation"],
      skipPrimary: false,
      woo: false,
    });
    expect(wooCommerceDrainPlan(["woocommerce-sync"])).toEqual({
      primary: undefined,
      skipPrimary: true,
      woo: true,
    });
    expect(wooCommerceDrainPlan(undefined).woo).toBe(false);
  });

  it("uses concurrency 4 when no bookings are in the batch", () => {
    expect(restDrainConcurrency(0)).toBe(4);
    expect(restDrainConcurrency(2)).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import { tourStorageKey } from "@/lib/dashboard/product-tour";

describe("tourStorageKey", () => {
  it("namespaces the dashboard tour flag by user", () => {
    expect(tourStorageKey("user-1")).toBe("postbus.tour.dashboard.v1:user-1");
  });
});

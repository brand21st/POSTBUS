import { describe, expect, it } from "vitest";
import { NOTIFICATIONS_REFETCH_INTERVAL_MS } from "@/lib/hooks/use-notifications";

describe("notification refresh", () => {
  it("polls often enough that new-order alerts are not stuck waiting on Realtime", () => {
    expect(NOTIFICATIONS_REFETCH_INTERVAL_MS).toBe(12_000);
    expect(NOTIFICATIONS_REFETCH_INTERVAL_MS).toBeGreaterThan(5_000);
  });
});

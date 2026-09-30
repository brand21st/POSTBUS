import { describe, expect, it } from "vitest";
import { NOTIFICATIONS_REFETCH_INTERVAL_MS } from "@/lib/hooks/use-notifications";

describe("notification refresh", () => {
  it("polls at most once per 45 seconds instead of every 5 seconds", () => {
    expect(NOTIFICATIONS_REFETCH_INTERVAL_MS).toBe(45_000);
    expect(NOTIFICATIONS_REFETCH_INTERVAL_MS).toBeGreaterThan(5_000);
  });
});

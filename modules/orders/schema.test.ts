import { describe, expect, it } from "vitest";
import { orderListQuery } from "@/modules/orders/schema";

describe("orderListQuery sort", () => {
  it("accepts created_at and order_number directions", () => {
    expect(orderListQuery.parse({ sort: "order_number" }).sort).toBe("order_number");
    expect(orderListQuery.parse({ sort: "-order_number" }).sort).toBe("-order_number");
    expect(orderListQuery.parse({ sort: "created_at" }).sort).toBe("created_at");
    expect(orderListQuery.parse({ sort: "-created_at" }).sort).toBe("-created_at");
    expect(orderListQuery.parse({}).sort).toBeUndefined();
  });

  it("rejects unknown sort values", () => {
    expect(() => orderListQuery.parse({ sort: "amount" })).toThrow();
  });
});

describe("orderListQuery counts", () => {
  it("accepts includeCounts without breaking existing list params", () => {
    const parsed = orderListQuery.parse({
      page: "1",
      pageSize: "20",
      includeCounts: "1",
      todayFrom: "2026-09-30T00:00:00.000Z",
      todayTo: "2026-09-30T23:59:59.999Z",
    });
    expect(parsed.includeCounts).toBe("1");
    expect(parsed.page).toBe(1);
    expect(parsed.pageSize).toBe(20);
  });
});

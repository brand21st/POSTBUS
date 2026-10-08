import { describe, expect, it } from "vitest";
import {
  isOrderNumberConflict,
  isPbSequenceNumber,
  nextPbOrderNumber,
  shouldReallocateOnConflict,
} from "@/modules/orders/order-number";

describe("nextPbOrderNumber", () => {
  it("starts at PB-10001 when the org has no PB sequence numbers", () => {
    expect(nextPbOrderNumber([])).toBe("PB-10001");
    expect(nextPbOrderNumber(["PB-BROWSER-TEST-2", "#1042"])).toBe("PB-10001");
  });

  it("increments past the highest existing PB sequence even when the row count is lower", () => {
    expect(nextPbOrderNumber(["PB-10016", "PB-10001", "PB-999"])).toBe("PB-10017");
  });
});

describe("shouldReallocateOnConflict", () => {
  it("reallocates blank and PB-##### values, but keeps custom ids", () => {
    expect(isPbSequenceNumber("PB-10024")).toBe(true);
    expect(shouldReallocateOnConflict("")).toBe(true);
    expect(shouldReallocateOnConflict("PB-10024")).toBe(true);
    expect(shouldReallocateOnConflict("PDDDf")).toBe(false);
  });
});

describe("isOrderNumberConflict", () => {
  it("detects the org+number unique index", () => {
    expect(
      isOrderNumberConflict('duplicate key value violates unique constraint "orders_org_number_idx"')
    ).toBe(true);
    expect(isOrderNumberConflict({ code: "23505", details: "Key (organization_id, order_number)=(…) already exists." })).toBe(
      true
    );
    expect(isOrderNumberConflict("Order failed.")).toBe(false);
  });
});

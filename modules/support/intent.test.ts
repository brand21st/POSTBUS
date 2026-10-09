import { describe, expect, it } from "vitest";
import { classifySupportIntent } from "@/modules/support/intent";

describe("classifySupportIntent", () => {
  it("detects cancellation, return, and exchange without creating extra tickets", () => {
    expect(classifySupportIntent("I want to cancel order #1052")).toEqual({
      category: "order_cancellation",
      workflowKind: "cancellation",
    });
    expect(classifySupportIntent("The shirt is damaged. I want to return it.")).toEqual({
      category: "product_return",
      workflowKind: "return",
    });
    expect(classifySupportIntent("Wrong size, please exchange")).toEqual({
      category: "product_exchange",
      workflowKind: "exchange",
    });
    expect(classifySupportIntent("Where is my parcel?")).toEqual({
      category: "general_inquiry",
      workflowKind: null,
    });
  });
});

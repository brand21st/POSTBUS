import { describe, expect, it } from "vitest";
import { multiUpPrintDecision } from "@/modules/labels/multi-up/print";

describe("multi-up print", () => {
  it("prints a named sheet only when the agent paper size matches", () => {
    expect(multiUpPrintDecision({ sheetPaper: "A4", agentPaper: "A4", connected: true })).toEqual({
      ok: true,
      paperSize: "A4",
    });
    expect(multiUpPrintDecision({ sheetPaper: "4x6", agentPaper: "A4", connected: true }).ok).toBe(false);
    expect(multiUpPrintDecision({ sheetPaper: "A5", agentPaper: "A5", connected: false }).ok).toBe(false);
    expect(multiUpPrintDecision({ sheetPaper: "custom", agentPaper: "A4", connected: true }).ok).toBe(false);
  });
});

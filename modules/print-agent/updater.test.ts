import { describe, expect, it } from "vitest";
import { isVersionNewer, resolvePrintAgentUpdate } from "@/modules/print-agent/updater";

describe("print-agent updater", () => {
  it("compares semantic versions", () => {
    expect(isVersionNewer("0.3.0", "0.2.0")).toBe(true);
    expect(isVersionNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isVersionNewer("v0.2.1", "0.2.0")).toBe(true);
    expect(isVersionNewer("0.2.0", "0.3.0")).toBe(false);
  });

  it("returns null when update env is not configured", () => {
    const previous = process.env.PRINT_AGENT_UPDATE_VERSION;
    delete process.env.PRINT_AGENT_UPDATE_VERSION;
    expect(resolvePrintAgentUpdate("windows", "x86_64", "0.1.0")).toBeNull();
    if (previous) process.env.PRINT_AGENT_UPDATE_VERSION = previous;
  });
});

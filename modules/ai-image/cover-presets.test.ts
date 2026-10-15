import { describe, expect, it } from "vitest";
import { buildCoverEditPrompt, identityRiskForEnhance } from "@/modules/ai-image/cover-presets";

describe("buildCoverEditPrompt", () => {
  it("keeps identity and forbids rendered text", () => {
    const prompt = buildCoverEditPrompt({ preset: "luxury", variant: "desktop" });
    expect(prompt).toMatch(/Preserve the actual product/i);
    expect(prompt).toMatch(/Do not render any text/i);
  });

  it("adds mobile composition guidance", () => {
    const prompt = buildCoverEditPrompt({ preset: "festival", festival: "onam", variant: "mobile" });
    expect(prompt).toMatch(/tall mobile hero/i);
    expect(prompt).toMatch(/Onam/i);
    expect(prompt).not.toMatch(/guaranteed/i);
  });
});

describe("identityRiskForEnhance", () => {
  it("flags background replacement", () => {
    expect(identityRiskForEnhance("replace_background")).toBe(true);
    expect(identityRiskForEnhance("lighting")).toBe(false);
  });
});

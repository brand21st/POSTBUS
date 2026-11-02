import { describe, expect, it } from "vitest";
import { buildEditPrompt, suggestedPresetForCategory } from "@/modules/ai-image/presets";
import { createJobSchema } from "@/modules/ai-image/service";
import { JOB_TYPES } from "@/types/domain";

describe("suggestedPresetForCategory", () => {
  it("suggests luxury studio for jewellery and perfume", () => {
    expect(suggestedPresetForCategory("Jewellery")).toBe("luxury_studio");
    expect(suggestedPresetForCategory("Perfume")).toBe("luxury_studio");
  });
});

describe("buildEditPrompt", () => {
  it("always includes identity preservation", () => {
    const prompt = buildEditPrompt({ preset: "clean_ecommerce" });
    expect(prompt).toMatch(/Preserve the actual product/i);
    expect(prompt).not.toMatch(/guaranteed conversion/i);
  });
});

describe("createJobSchema", () => {
  it("rejects an empty body", () => {
    expect(() => createJobSchema.parse({})).toThrow();
  });
});

describe("JOB_TYPES", () => {
  it("includes ai-image", () => {
    expect(JOB_TYPES).toContain("ai-image");
  });
});

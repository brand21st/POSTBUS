import { describe, expect, it } from "vitest";
import { enhanceStudioPromptSchema, parseEnhancedStudioPrompt } from "@/modules/ai-image/enhance-prompt";

describe("enhanceStudioPromptSchema", () => {
  it("accepts an empty draft and a style preset", () => {
    const parsed = enhanceStudioPromptSchema.parse({ preset: "clean_ecommerce", productName: "Kasavu Saree" });
    expect(parsed.prompt).toBe("");
    expect(parsed.productName).toBe("Kasavu Saree");
  });

  it("rejects a prompt over 500 characters", () => {
    expect(() => enhanceStudioPromptSchema.parse({ prompt: "x".repeat(501) })).toThrow();
  });
});

describe("parseEnhancedStudioPrompt", () => {
  it("returns a trimmed prompt", () => {
    expect(parseEnhancedStudioPrompt({ prompt: "  Soft cream backdrop, keep kasavu border sharp.  " })).toBe(
      "Soft cream backdrop, keep kasavu border sharp."
    );
  });

  it("rejects empty AI output", () => {
    expect(() => parseEnhancedStudioPrompt({ prompt: "short" })).toThrow("usable prompt");
  });
});

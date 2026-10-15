import { describe, expect, it } from "vitest";
import { coverCopySchema, parseCoverCopyJson } from "@/modules/openrouter/cover-copy";

describe("coverCopySchema", () => {
  it("defaults to generate", () => {
    expect(coverCopySchema.parse({ productName: "Kasavu Saree" }).action).toBe("generate");
  });
});

describe("parseCoverCopyJson", () => {
  it("maps headlines", () => {
    const parsed = parseCoverCopyJson(
      JSON.stringify({
        headlines: [{ text: "Celebrate in Style", category: "Festival" }],
        subheadline: "Explore the festive edit",
        hook: "Handloom, made for Onam",
        cta: "Shop collection",
      })
    );
    expect(parsed.headlines[0]?.text).toMatch(/Celebrate/);
    expect(parsed.cta).toBe("Shop collection");
  });
});

import { describe, expect, it } from "vitest";
import {
  parseDataImage,
  parseProductCopyJson,
  productAiCopySchema,
  visionSafeOpenRouterModel,
} from "@/modules/openrouter/product-copy";

const jpeg = `data:image/jpeg;base64,${Buffer.alloc(32, 1).toString("base64")}`;

describe("productAiCopySchema", () => {
  it("rejects empty prompt and no images", () => {
    expect(() => productAiCopySchema.parse({ prompt: "  ", images: [] })).toThrow();
  });

  it("accepts prompt only", () => {
    const parsed = productAiCopySchema.parse({ prompt: "Handloom cotton saree" });
    expect(parsed.prompt).toBe("Handloom cotton saree");
    expect(parsed.images).toEqual([]);
  });

  it("accepts a compressed data URL image", () => {
    const parsed = productAiCopySchema.parse({ images: [jpeg] });
    expect(parsed.images).toHaveLength(1);
  });

  it("rejects http image URLs", () => {
    expect(() =>
      productAiCopySchema.parse({ images: ["https://evil.example/photo.jpg"] })
    ).toThrow();
  });

  it("rejects more than three images", () => {
    expect(() => productAiCopySchema.parse({ images: [jpeg, jpeg, jpeg, jpeg] })).toThrow();
  });
});

describe("parseDataImage", () => {
  it("rejects oversized payloads", () => {
    const huge = `data:image/png;base64,${Buffer.alloc(401 * 1024, 2).toString("base64")}`;
    expect(parseDataImage(huge).ok).toBe(false);
  });
});

describe("visionSafeOpenRouterModel", () => {
  it("keeps gpt-4o-mini when images are attached", () => {
    expect(visionSafeOpenRouterModel("openai/gpt-4o-mini", true)).toBe("openai/gpt-4o-mini");
  });

  it("falls back from o-series and nano when images are attached", () => {
    expect(visionSafeOpenRouterModel("openai/o3-mini", true)).toBe("openai/gpt-4o-mini");
    expect(visionSafeOpenRouterModel("openai/gpt-4.1-nano", true)).toBe("openai/gpt-4o-mini");
  });
});

describe("parseProductCopyJson", () => {
  it("maps title and description", () => {
    expect(
      parseProductCopyJson({
        title: "Handloom Cotton Saree for Weddings",
        description: "Soft handloom cotton, easy to drape for festive days.",
      })
    ).toEqual({
      title: "Handloom Cotton Saree for Weddings",
      description: "Soft handloom cotton, easy to drape for festive days.",
    });
  });
});

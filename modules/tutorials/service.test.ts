import { describe, expect, it } from "vitest";
import { categoryDeleteBlockReason, mapPublicTutorial, slugify, type TutorialRow } from "./service";

describe("tutorial helpers", () => {
  it("slugifies titles the same way as plans", () => {
    expect(slugify("How to Connect Shopify")).toBe("how-to-connect-shopify");
    expect(slugify("  India Post!!  ")).toBe("india-post");
  });

  it("blocks category delete when tutorials still exist", () => {
    expect(categoryDeleteBlockReason(0)).toBeNull();
    expect(categoryDeleteBlockReason(2)).toBe("Move or delete tutorials in this category first.");
  });

  it("never exposes draft status on the public mapper payload", () => {
    const mapped = mapPublicTutorial({
      id: "1",
      category_id: "c1",
      title: "Hidden draft",
      slug: "hidden-draft",
      description: null,
      youtube_url: "https://youtu.be/dQw4w9WgXcQ",
      status: "draft",
      sort_order: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      tutorial_categories: { id: "c1", name: "Shopify", slug: "shopify" },
    } satisfies TutorialRow);
    expect(mapped).not.toHaveProperty("status");
    expect(mapped.provider).toBe("youtube");
    expect(mapped.thumbnailUrl).toContain("dQw4w9WgXcQ");
    expect(mapped.embedUrl).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("maps Vimeo source links to player embeds", () => {
    const mapped = mapPublicTutorial({
      id: "2",
      category_id: "c1",
      title: "Vimeo walkthrough",
      slug: "vimeo-walkthrough",
      description: null,
      youtube_url: "https://vimeo.com/123456789/privhash",
      status: "published",
      sort_order: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      tutorial_categories: { id: "c1", name: "Shopify", slug: "shopify" },
    } satisfies TutorialRow);
    expect(mapped.provider).toBe("vimeo");
    expect(mapped.embedUrl).toBe("https://player.vimeo.com/video/123456789?h=privhash");
    expect(mapped.thumbnailUrl).toBe("");
  });
});

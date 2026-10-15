import { describe, expect, it } from "vitest";
import { coverLifecycle, eligibleCovers, type CoverRecord } from "@/modules/storefront/cover-model";

function cover(partial: Partial<CoverRecord>): CoverRecord {
  return {
    id: partial.id ?? "1",
    name: null,
    imageUrl: "https://cdn.example/a.jpg",
    imagePath: "a.jpg",
    mobileImageUrl: null,
    mobileImagePath: null,
    title: "Hello",
    subtitle: null,
    hook: null,
    description: null,
    ctaLabel: "Shop",
    ctaHref: "/store/x",
    offerBadge: null,
    discountPercent: null,
    coverType: "homepage_hero",
    status: "PUBLISHED",
    textPosition: "left",
    overlayStrength: 40,
    textColor: "#ffffff",
    desktopFocal: { x: 50, y: 50 },
    mobileFocal: { x: 50, y: 50 },
    luminance: 0.4,
    startsAt: null,
    endsAt: null,
    sourceAssetId: null,
    aiAssetId: null,
    festival: null,
    preset: null,
    sortOrder: 0,
    enabled: true,
    ...partial,
  };
}

describe("eligibleCovers", () => {
  const now = new Date("2026-10-11T10:00:00.000Z");

  it("keeps live published covers and skips drafts archived scheduled and expired", () => {
    const list = [
      cover({ id: "live", sortOrder: 1 }),
      cover({ id: "draft", status: "DRAFT", sortOrder: 0 }),
      cover({ id: "archived", status: "ARCHIVED" }),
      cover({ id: "soon", startsAt: "2026-10-12T00:00:00.000Z" }),
      cover({ id: "old", endsAt: "2026-10-01T00:00:00.000Z" }),
      cover({ id: "blank", imageUrl: "" }),
    ];
    expect(eligibleCovers(list, now).map((item) => item.id)).toEqual(["live"]);
  });

  it("falls through to the next eligible cover in sort order", () => {
    const list = [
      cover({ id: "expired", endsAt: "2026-10-01T00:00:00.000Z", sortOrder: 0 }),
      cover({ id: "next", sortOrder: 2 }),
      cover({ id: "also", sortOrder: 1 }),
    ];
    expect(eligibleCovers(list, now).map((item) => item.id)).toEqual(["also", "next"]);
  });
});

describe("coverLifecycle", () => {
  it("labels scheduled and expired windows", () => {
    const now = new Date("2026-10-11T10:00:00.000Z");
    expect(coverLifecycle(cover({ startsAt: "2026-10-20T00:00:00.000Z" }), now)).toBe("scheduled");
    expect(coverLifecycle(cover({ endsAt: "2026-10-01T00:00:00.000Z" }), now)).toBe("expired");
  });
});

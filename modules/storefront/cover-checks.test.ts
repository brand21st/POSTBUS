import { describe, expect, it } from "vitest";
import { evaluateCoverChecks } from "@/modules/storefront/cover-checks";

describe("evaluateCoverChecks", () => {
  it("flags missing mobile image and offer mismatch", () => {
    const checks = evaluateCoverChecks({
      title: "Celebrate in Style",
      ctaLabel: "Shop",
      ctaHref: "/store/x",
      offerBadge: "40% off",
      discountPercent: 20,
      imageUrl: "https://cdn.example/a.jpg",
      overlayStrength: 50,
      textColor: "#ffffff",
      luminance: 0.2,
    });
    expect(checks.find((item) => item.id === "mobile")?.ok).toBe(false);
    expect(checks.find((item) => item.id === "offer")?.ok).toBe(false);
  });

  it("passes a complete cover", () => {
    const checks = evaluateCoverChecks({
      title: "Celebrate in Style",
      ctaLabel: "Shop collection",
      ctaHref: "/store/x",
      offerBadge: "20% off",
      discountPercent: 20,
      imageUrl: "https://cdn.example/a.jpg",
      mobileImageUrl: "https://cdn.example/m.jpg",
      overlayStrength: 50,
      textColor: "#ffffff",
      luminance: 0.2,
      desktopFocal: { x: 50, y: 50 },
    });
    expect(checks.every((item) => item.ok)).toBe(true);
  });

  it("flags weak headline contrast", () => {
    const checks = evaluateCoverChecks({
      title: "Celebrate in Style",
      ctaLabel: "Shop",
      ctaHref: "/store/x",
      imageUrl: "https://cdn.example/a.jpg",
      mobileImageUrl: "https://cdn.example/m.jpg",
      overlayStrength: 0,
      textColor: "#808080",
      luminance: 0.7,
    });
    expect(checks.find((item) => item.id === "contrast")?.ok).toBe(false);
  });
});

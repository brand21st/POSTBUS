import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mapProductImageUrls,
  productCoverImageUrl,
  productImagePublicUrl,
  productImageStoragePath,
} from "@/modules/products/images";

describe("product image paths", () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  });

  it("maps storage paths to public URLs", () => {
    const mapped = mapProductImageUrls(["org-1/prod-1/cover.jpg"]);
    expect(mapped.imagePaths).toEqual(["org-1/prod-1/cover.jpg"]);
    expect(mapped.imageUrls).toEqual([
      "https://proj.supabase.co/storage/v1/object/public/product-images/org-1/prod-1/cover.jpg",
    ]);
    expect(productCoverImageUrl(["org-1/prod-1/cover.jpg", "org-1/prod-1/side.jpg"])).toContain("cover.jpg");
  });

  it("round-trips a public URL back to a storage path", () => {
    const url =
      "https://proj.supabase.co/storage/v1/object/public/product-images/org-1/prod-1/cover.jpg?v=1";
    expect(productImageStoragePath(url)).toBe("org-1/prod-1/cover.jpg");
    expect(productImagePublicUrl("org-1/prod-1/cover.jpg")).toContain("product-images/org-1/prod-1/cover.jpg");
  });

  it("keeps at most 3 photos", () => {
    expect(mapProductImageUrls(["a", "b", "c", "d"]).imagePaths).toEqual(["a", "b", "c"]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/labels/storage", () => ({
  readLabelPdfIfPresent: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/admin", () => ({
  hasAdminClient: () => false,
  createAdminClient: () => {
    throw new Error("admin client is not configured");
  },
}));

const pdf = Buffer.from("%PDF-1.4 official");

function supabaseWithMiss() {
  return {
    storage: {
      from: () => ({
        download: async () => ({ data: null }),
        createSignedUrl: async () => ({ data: null }),
      }),
    },
  };
}

describe("loadLabelPdfBytes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the official PDF from file_url when disk and storage miss", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } }))
    );
    const { loadLabelPdfBytes } = await import("@/modules/labels/load");
    const bytes = await loadLabelPdfBytes(supabaseWithMiss() as never, "org-1", {
      id: "label-1",
      file_path: "org-1/label-1.pdf",
      file_url: "https://example.com/india-post.pdf",
    });
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe("%PDF");
  });
});

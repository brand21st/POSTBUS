import { describe, expect, it, vi } from "vitest";
import { findReadyIndiaPostLabel } from "@/modules/labels/ready";

describe("findReadyIndiaPostLabel", () => {
  it("returns the latest READY India Post file for reuse", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "label-1", file_path: "org/ship/label-1.pdf", file_url: "https://files/label.pdf", status: "READY" },
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle,
      }),
    };
    const found = await findReadyIndiaPostLabel(supabase as never, "org-1", "ship-1");
    expect(found).toEqual({
      id: "label-1",
      file_path: "org/ship/label-1.pdf",
      file_url: "https://files/label.pdf",
      status: "READY",
    });
  });

  it("skips rows that have no stored file", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "label-1", file_path: null, file_url: null, status: "READY" },
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle,
      }),
    };
    await expect(findReadyIndiaPostLabel(supabase as never, "org-1", "ship-1")).resolves.toBeNull();
  });
});

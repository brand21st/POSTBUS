import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublishedTrackingHost, probePublicTrackingHost } from "./public-host";

describe("probePublicTrackingHost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats 200 as live", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 200 })
    );
    await expect(probePublicTrackingHost("https://saneesh-e.postbus.in")).resolves.toBe(true);
  });

  it("treats 503 as not live", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 503 })
    );
    await expect(probePublicTrackingHost("https://saneesh-e.postbus.in")).resolves.toBe(false);
  });

  it("treats network errors as not live", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(probePublicTrackingHost("https://saneesh-e.postbus.in")).resolves.toBe(false);
  });
});

describe("checkPublishedTrackingHost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not probe unpublished pages", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const supabase = { from: vi.fn() };
    const result = await checkPublishedTrackingHost(supabase as never, {
      id: "page-1",
      organizationId: "org-1",
      subdomain: "saneesh-e",
      status: "DRAFT",
    });
    expect(result.status).toBe("unpublished");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns connecting when the public host is not ready", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 503 }));
    const result = await checkPublishedTrackingHost({ from: vi.fn() } as never, {
      id: "page-1",
      organizationId: "org-1",
      subdomain: "saneesh-e",
      status: "PUBLISHED",
    });
    expect(result.status).toBe("connecting");
    expect(result.notified).toBe(false);
  });
});

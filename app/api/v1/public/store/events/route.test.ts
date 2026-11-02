import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const publicStoreClient = vi.hoisted(() => vi.fn());
const organizationFromLink = vi.hoisted(() => vi.fn());
const assertStorePublished = vi.hoisted(() => vi.fn());

vi.mock("@/modules/storefront/public", () => ({
  publicStoreClient,
  organizationFromLink,
  assertStorePublished,
}));

vi.mock("@/lib/security/rate-limit", () => ({
  rateLimit: () => ({ ok: true }),
}));

describe("POST /api/v1/public/store/events cover", () => {
  const insert = vi.fn();
  const slidesMaybe = vi.fn();

  beforeEach(() => {
    insert.mockReset();
    slidesMaybe.mockReset();
    organizationFromLink.mockResolvedValue("org-1");
    assertStorePublished.mockResolvedValue(undefined);
    publicStoreClient.mockReturnValue({
      from: (table: string) => {
        if (table === "storefront_slides") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => Promise.resolve({ count: slidesMaybe(), error: null }),
              }),
            }),
          };
        }
        return {
          insert: (row: unknown) => {
            insert(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    });
  });

  async function post(body: unknown, ua?: string) {
    const { POST } = await import("./route");
    return POST(
      new NextRequest("http://localhost:3000/api/v1/public/store/events", {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": ua ?? "Mozilla/5.0" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({}) }
    );
  }

  it("records a cover impression for an owned slide", async () => {
    slidesMaybe.mockReturnValue(1);
    const response = await post({
      workspace: "samanga",
      eventType: "COVER_IMPRESSION",
      slideId: "11111111-1111-4111-8111-111111111111",
      sessionId: "sess-1",
    });
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: "COVER_IMPRESSION", organization_id: "org-1" }));
  });

  it("rejects a slide that is not in the org", async () => {
    slidesMaybe.mockReturnValue(0);
    const response = await post({
      workspace: "samanga",
      eventType: "COVER_IMPRESSION",
      slideId: "11111111-1111-4111-8111-111111111111",
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("skips known bots", async () => {
    slidesMaybe.mockReturnValue(1);
    const response = await post(
      {
        workspace: "samanga",
        eventType: "COVER_IMPRESSION",
        slideId: "11111111-1111-4111-8111-111111111111",
      },
      "Googlebot/2.1"
    );
    const json = await response.json();
    expect(json.skipped ?? json.data?.skipped).toBeTruthy();
    expect(insert).not.toHaveBeenCalled();
  });
});

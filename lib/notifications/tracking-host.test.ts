import { describe, expect, it, vi } from "vitest";
import {
  notifyTrackingHostLive,
  TRACKING_HOST_LIVE_NOTIFICATION,
  TRACKING_HOST_LIVE_TITLE,
} from "./tracking-host";

function listResult<T>(result: T) {
  const self: Record<string, unknown> = {};
  self.select = () => self;
  self.eq = () => self;
  self.gte = () => self;
  self.limit = () => self;
  self.then = (resolve: (value: T) => unknown) => Promise.resolve(result).then(resolve);
  return self;
}

describe("notifyTrackingHostLive", () => {
  it("inserts once when the public host becomes live", async () => {
    const inserts: unknown[] = [];
    let lookedUp = false;
    const supabase = {
      from: vi.fn(() => {
        if (!lookedUp) {
          lookedUp = true;
          return { select: () => listResult({ data: [], error: null }) };
        }
        return {
          insert: async (row: unknown) => {
            inserts.push(row);
            return { error: null };
          },
        };
      }),
    };

    const first = await notifyTrackingHostLive(supabase as never, {
      organizationId: "org-1",
      trackingPageId: "page-1",
      domain: "https://saneesh-e.postbus.in",
    });
    expect(first).toBe(true);
    expect(inserts[0]).toMatchObject({
      type: TRACKING_HOST_LIVE_NOTIFICATION,
      title: TRACKING_HOST_LIVE_TITLE,
      body: "https://saneesh-e.postbus.in",
      entity_type: "tracking_page",
      entity_id: "page-1",
    });
  });

  it("skips a duplicate live notice for the same URL", async () => {
    const inserts: unknown[] = [];
    const supabase = {
      from: vi.fn(() => ({
        select: () => listResult({ data: [{ id: "n1" }], error: null }),
        insert: async (row: unknown) => {
          inserts.push(row);
          return { error: null };
        },
      })),
    };
    const notified = await notifyTrackingHostLive(supabase as never, {
      organizationId: "org-1",
      trackingPageId: "page-1",
      domain: "https://saneesh-e.postbus.in",
    });
    expect(notified).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

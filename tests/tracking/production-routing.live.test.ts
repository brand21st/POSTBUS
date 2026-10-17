import { describe, expect, it } from "vitest";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import type { PublicTrackResult, TrackingEvent } from "@/types/api";

const BASE = process.env.POSTBUS_PROD_URL || "https://www.postbus.in";

async function json(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 300);
  }
  return { status: response.status, body };
}

describe("production routing cross HTTP", () => {
  it("API and database health are up", async () => {
    const { status, body } = await json("/api/health");
    expect(status).toBe(200);
    const payload = body as { success?: boolean; data?: { api?: string; database?: string } };
    expect(payload.success).toBe(true);
    expect(payload.data?.api).toBe("Healthy");
    expect(payload.data?.database).toBe("Healthy");
  });

  it("dashboard shipment detail requires a session", async () => {
    const { status, body } = await json("/api/v1/shipments/00000000-0000-4000-8000-000000000000");
    expect(status).toBe(401);
    const payload = body as { errors?: Array<{ code?: string }> };
    expect(payload.errors?.[0]?.code).toBe("AUTH_REQUIRED");
  });

  it("unknown India Post webhook connection is not found", async () => {
    const { status, body } = await json(
      "/api/v1/webhooks/india-post/00000000-0000-4000-8000-000000000000/events",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ article_number: "XX000000000IN", event_code: "BAG_CLOSE" }),
      }
    );
    expect(status).toBe(404);
    const payload = body as { errors?: Array<{ code?: string }> };
    expect(payload.errors?.[0]?.code).toBe("RESOURCE_NOT_FOUND");
  });

  it("public track returns a stored journey that builds Routing Steps", async () => {
    const { status, body } = await json("/api/v1/public/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "CL556974885IN" }),
    });
    expect(status).toBe(200);
    const payload = body as { success?: boolean; data?: PublicTrackResult };
    expect(payload.success).toBe(true);
    expect(payload.data?.found).toBe(true);
    const shipment = payload.data?.shipment;
    expect(shipment?.trackingNumber ?? shipment?.barcode).toMatch(/CL556974885IN/);
    const events = (shipment?.events ?? []) as TrackingEvent[];
    expect(events.length).toBeGreaterThanOrEqual(10);
    const view = buildIndiaPostRoutingView(
      {
        barcode: shipment?.barcode,
        trackingNumber: shipment?.trackingNumber,
        status: shipment?.status,
        operationalStatus: shipment?.operationalStatus,
        lastEventAt: shipment?.lastEventAt,
      },
      events
    );
    expect(view.steps.length).toBe(events.length);
    expect(view.steps.at(-1)?.title?.toLowerCase()).toContain("delivered");
    expect(view.progressPercent).toBe(100);
  });

  it("public track of a booked article with no scans has empty Routing Steps", async () => {
    const { status, body } = await json("/api/v1/public/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "CX075364295IN" }),
    });
    expect(status).toBe(200);
    const payload = body as { success?: boolean; data?: PublicTrackResult };
    expect(payload.success).toBe(true);
    expect(payload.data?.found).toBe(true);
    const events = (payload.data?.shipment?.events ?? []) as TrackingEvent[];
    const view = buildIndiaPostRoutingView(
      {
        barcode: payload.data?.shipment?.barcode,
        trackingNumber: payload.data?.shipment?.trackingNumber,
        status: payload.data?.shipment?.status,
        operationalStatus: payload.data?.shipment?.operationalStatus,
      },
      events
    );
    expect(view.steps).toEqual([]);
  });
});

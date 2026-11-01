import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/api/context";
import { permissionForTenantRoute } from "@/lib/api/v1-permissions";
import { bookingQueueAutomationEnabledFor } from "@/modules/booking-queue/flags";
import {
  parseAutomationInput,
  publicAutomationSettings,
  resolveImportBookingRoute,
  saveBookingAutomationSettings,
} from "@/modules/booking-queue/settings";
import { draftFromSettings, settingsBody, waitLabel } from "@/components/booking-queue/automation-settings-dialog";

const enqueueOrders = vi.fn();
vi.mock("@/modules/booking-queue/service", () => ({ enqueueOrders: (...args: unknown[]) => enqueueOrders(...args) }));
vi.mock("@/lib/hooks/use-api", () => ({ api: vi.fn(), ApiError: class extends Error {} }));

const { enrollOrderAutomatically } = await import("@/modules/booking-queue/auto-enroll");

type Row = Record<string, unknown>;

function memory(tables: Record<string, Row[]>, failOn?: string) {
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let payload: Row | null = null;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (failOn === table) return { data: null, error: { message: "relation does not exist", code: "42P01" } };
      if (op === "insert") {
        const row = { ...payload! };
        rows().push(row);
        return { data: [row], error: null };
      }
      const matched = rows().filter((row) => filters.every((test) => test(row)));
      if (op === "update") for (const row of matched) Object.assign(row, payload);
      return { data: matched, error: null };
    };
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (value: Row) => ((op = "insert"), (payload = value), builder),
      update: (value: Row) => ((op = "update"), (payload = value), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      single: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve().then(run).then(resolve, reject),
    };
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

const ctx: TenantContext = {
  userId: "user-1",
  email: null,
  fullName: null,
  organizationId: "org-1",
  organizationName: "Org",
  role: "OWNER",
  permissions: [],
};

const FLAGS = { queue: process.env.BOOKING_QUEUE_ORGS, automation: process.env.BOOKING_QUEUE_AUTOMATION_ORGS };

beforeEach(() => {
  process.env.BOOKING_QUEUE_ORGS = "org-1";
  delete process.env.BOOKING_QUEUE_AUTOMATION_ORGS;
  enqueueOrders.mockReset();
});

afterEach(() => {
  process.env.BOOKING_QUEUE_ORGS = FLAGS.queue;
  process.env.BOOKING_QUEUE_AUTOMATION_ORGS = FLAGS.automation;
});

const valid = { version: 0, mode: "MANUAL", enrollmentSources: ["SHOPIFY"], batchThreshold: 50, maxWaitMinutes: 30, paused: false };

describe("automation rollout gate", () => {
  it("TEST 25: stays off when the automation allowlist is unset, even if the queue is on for everyone", () => {
    process.env.BOOKING_QUEUE_ORGS = "*";
    delete process.env.BOOKING_QUEUE_AUTOMATION_ORGS;
    expect(bookingQueueAutomationEnabledFor("org-1")).toBe(false);
    process.env.BOOKING_QUEUE_AUTOMATION_ORGS = "org-1";
    expect(bookingQueueAutomationEnabledFor("org-1")).toBe(true);
    process.env.BOOKING_QUEUE_ORGS = "";
    expect(bookingQueueAutomationEnabledFor("org-1")).toBe(false);
  });

  it("treats a saved automatic mode as manual outside the rollout", () => {
    const row = {
      mode: "AUTOMATIC",
      enrollment_sources: ["SHOPIFY", "FAX"],
      batch_threshold: 100,
      max_wait_minutes: 30,
      paused_at: null,
      version: 3,
      last_error: null,
      last_dispatch_at: null,
    };
    expect(publicAutomationSettings(row, false)).toMatchObject({ mode: "MANUAL", enrollmentSources: ["SHOPIFY"], version: 3 });
    expect(publicAutomationSettings(row, true).mode).toBe("AUTOMATIC");
    expect(publicAutomationSettings(null, false)).toMatchObject({ mode: "MANUAL", version: 0, batchThreshold: 50 });
  });
});

describe("settings validation", () => {
  it("accepts presets, custom values and numeric strings", () => {
    expect(parseAutomationInput({ ...valid, batchThreshold: "275", maxWaitMinutes: "45" }, { automationAvailable: false })).toEqual({
      version: 0,
      mode: "MANUAL",
      enrollmentSources: ["SHOPIFY"],
      batchThreshold: 275,
      maxWaitMinutes: 45,
      paused: false,
    });
    expect(parseAutomationInput({ ...valid, maxWaitMinutes: null }, { automationAvailable: false }).maxWaitMinutes).toBeNull();
  });

  it("TEST 17: allows a logical batch of 5000 but nothing above or below the range", () => {
    expect(parseAutomationInput({ ...valid, batchThreshold: 5000 }, { automationAvailable: false }).batchThreshold).toBe(5000);
    for (const bad of [0, 5001, 12.5, "abc", null]) {
      expect(() => parseAutomationInput({ ...valid, batchThreshold: bad }, { automationAvailable: false })).toThrow(/1 to 5000/);
    }
  });

  it("checks the maximum wait range and requires one in automatic mode", () => {
    expect(() => parseAutomationInput({ ...valid, maxWaitMinutes: 4 }, { automationAvailable: true })).toThrow(/Maximum wait/);
    expect(() => parseAutomationInput({ ...valid, maxWaitMinutes: 1441 }, { automationAvailable: true })).toThrow(/Maximum wait/);
    expect(() => parseAutomationInput({ ...valid, mode: "AUTOMATIC", maxWaitMinutes: null }, { automationAvailable: true })).toThrow(
      /needs a maximum wait/
    );
  });

  it("refuses automatic mode outside the rollout and sources that cannot enroll by themselves", () => {
    expect(() => parseAutomationInput({ ...valid, mode: "AUTOMATIC" }, { automationAvailable: false })).toThrow(/not available/);
    expect(() => parseAutomationInput({ ...valid, enrollmentSources: ["SHOPIFY", "EXCEL"] }, { automationAvailable: true })).toThrow(
      /EXCEL/
    );
    expect(() => parseAutomationInput({ ...valid, mode: "WHENEVER" }, { automationAvailable: true })).toThrow(/Manual or Automatic/);
    expect(() => parseAutomationInput({ ...valid, version: undefined }, { automationAvailable: true })).toThrow(/Reload/);
  });
});

describe("saving settings", () => {
  it("creates the row at version 1, then only updates the version it read", async () => {
    const tables: Record<string, Row[]> = { booking_automation_settings: [], audit_logs: [] };
    const client = memory(tables);
    const first = await saveBookingAutomationSettings(client, ctx, { ...valid, paused: true });
    expect(first).toMatchObject({ version: 1, paused: true, enrollmentSources: ["SHOPIFY"] });
    expect(tables.booking_automation_settings[0]).toMatchObject({ organization_id: "org-1", paused_by: "user-1", updated_by: "user-1" });
    expect(tables.audit_logs[0]).toMatchObject({ action: "booking_queue.settings_updated", actor_id: "user-1" });

    await expect(saveBookingAutomationSettings(client, ctx, { ...valid, version: 0 })).rejects.toThrow(/changed by someone else/);
    const second = await saveBookingAutomationSettings(client, ctx, { ...valid, version: 1, batchThreshold: 100, paused: false });
    expect(second).toMatchObject({ version: 2, batchThreshold: 100, paused: false });
    expect(tables.booking_automation_settings[0].paused_at).toBeNull();
  });

  it("only owners and admins may change automation", () => {
    expect(permissionForTenantRoute("PATCH", "booking-queue/settings", ["booking-queue", "settings"])).toBe("integrations.manage");
    expect(permissionForTenantRoute("GET", "booking-queue/settings", ["booking-queue", "settings"])).toBe("shipments.read");
  });
});

describe("who books an imported order", () => {
  it("routes a source to the queue only when the workspace enrolled it", async () => {
    const client = memory({ booking_automation_settings: [{ organization_id: "org-1", enrollment_sources: ["SHOPIFY"] }] });
    expect(await resolveImportBookingRoute(client, "org-1", "SHOPIFY")).toBe("QUEUE");
    expect(await resolveImportBookingRoute(client, "org-1", "WOOCOMMERCE")).toBe("LEGACY");
    process.env.BOOKING_QUEUE_ORGS = "";
    expect(await resolveImportBookingRoute(client, "org-1", "SHOPIFY")).toBe("LEGACY");
  });

  it("falls back to the existing path when settings cannot be read", async () => {
    expect(await resolveImportBookingRoute(memory({}, "booking_automation_settings"), "org-1", "SHOPIFY")).toBe("LEGACY");
    expect(await resolveImportBookingRoute(memory({ booking_automation_settings: [] }), "org-1", "SHOPIFY")).toBe("LEGACY");
  });
});

describe("automatic enrollment after an import", () => {
  function tables(mode: string, payment: string, sources = ["SHOPIFY"]) {
    return {
      booking_automation_settings: [{ organization_id: "org-1", mode, enrollment_sources: sources }],
      orders: [{ id: "o1", organization_id: "org-1", source: "SHOPIFY", status: "IMPORTED", payment_status: payment, shipments: [] }],
    };
  }

  it("adds a settled order for approval in manual mode", async () => {
    enqueueOrders.mockResolvedValue({ enqueued: [{ orderId: "o1", itemId: "i1", state: "WAITING_APPROVAL", warnings: [] }], skipped: [] });
    const outcome = await enrollOrderAutomatically(memory(tables("MANUAL", "PAID")), { organizationId: "org-1", orderId: "o1", source: "SHOPIFY" });
    expect(outcome).toEqual({ enrolled: true, state: "WAITING_APPROVAL" });
    expect(enqueueOrders.mock.calls[0][3]).toEqual({ via: "AUTO", autoApprove: false });
  });

  it("skips approval only in automatic mode inside the automation rollout", async () => {
    enqueueOrders.mockResolvedValue({ enqueued: [{ orderId: "o1", itemId: "i1", state: "READY_FOR_BOOKING", warnings: [] }], skipped: [] });
    await enrollOrderAutomatically(memory(tables("AUTOMATIC", "COD")), { organizationId: "org-1", orderId: "o1", source: "SHOPIFY" });
    expect(enqueueOrders.mock.calls[0][3]).toEqual({ via: "AUTO", autoApprove: false });
    process.env.BOOKING_QUEUE_AUTOMATION_ORGS = "org-1";
    await enrollOrderAutomatically(memory(tables("AUTOMATIC", "COD")), { organizationId: "org-1", orderId: "o1", source: "SHOPIFY" });
    expect(enqueueOrders.mock.calls[1][3]).toEqual({ via: "AUTO", autoApprove: true });
  });

  it("TEST 15: never enrolls partially paid or pending orders by itself", async () => {
    for (const payment of ["PARTIAL", "PENDING"]) {
      const outcome = await enrollOrderAutomatically(memory(tables("MANUAL", payment)), { organizationId: "org-1", orderId: "o1", source: "SHOPIFY" });
      expect(outcome).toEqual({ enrolled: false, reason: "NOT_ELIGIBLE" });
    }
    expect(enqueueOrders).not.toHaveBeenCalled();
  });

  it("does nothing for sources the workspace did not enroll, and never throws", async () => {
    expect(
      await enrollOrderAutomatically(memory(tables("MANUAL", "PAID", ["WOOCOMMERCE"])), { organizationId: "org-1", orderId: "o1", source: "SHOPIFY" })
    ).toEqual({ enrolled: false, reason: "SOURCE_OFF" });
    enqueueOrders.mockRejectedValue(new Error("boom"));
    expect(await enrollOrderAutomatically(memory(tables("MANUAL", "PAID")), { organizationId: "org-1", orderId: "o1", source: "SHOPIFY" })).toEqual({
      enrolled: false,
      reason: "ERROR",
    });
  });
});

describe("settings form", () => {
  const saved = {
    mode: "MANUAL" as const,
    enrollmentSources: ["WOOCOMMERCE" as const],
    batchThreshold: 275,
    maxWaitMinutes: 45,
    paused: false,
    pausedAt: null,
    version: 4,
    automationAvailable: false,
    lastError: null,
    lastDispatchAt: null,
  };

  it("round-trips custom values into the request body", () => {
    const draft = draftFromSettings(saved);
    expect(draft).toMatchObject({ thresholdChoice: "custom", customThreshold: "275", waitChoice: "custom", customWait: "45" });
    expect(settingsBody(draft, 4)).toEqual({
      version: 4,
      mode: "MANUAL",
      enrollmentSources: ["WOOCOMMERCE"],
      batchThreshold: 275,
      maxWaitMinutes: 45,
      paused: false,
    });
  });

  it("uses presets and 'no limit' when they match", () => {
    const draft = draftFromSettings({ ...saved, batchThreshold: 100, maxWaitMinutes: null });
    expect(draft).toMatchObject({ thresholdChoice: "100", waitChoice: "none" });
    expect(settingsBody(draft, 1)).toMatchObject({ batchThreshold: 100, maxWaitMinutes: null });
    expect(waitLabel(45)).toBe("45 min");
    expect(waitLabel(120)).toBe("2 h");
  });
});

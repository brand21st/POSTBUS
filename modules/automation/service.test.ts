import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/api/errors";
import {
  AUTOMATION_DEFAULTS,
  getAutomationSettings,
  isAutoShopifySyncEnabled,
  mapAutomationSettings,
  updateAutomationSettings,
} from "@/modules/automation/service";
import type { TenantContext } from "@/lib/api/context";

const row = {
  organization_id: "org-1",
  ...AUTOMATION_DEFAULTS,
};

const ctx: TenantContext = {
  userId: "user-1",
  email: "owner@example.com",
  fullName: "Owner",
  organizationId: "org-1",
  organizationName: "Acme",
  role: "OWNER",
  permissions: [],
};

function automationClient(options?: {
  existing?: typeof row | null;
  onUpdate?: (payload: Record<string, unknown>) => void;
}) {
  const existing = options?.existing === undefined ? row : options.existing;
  return {
    from: vi.fn((table: string) => {
      if (table === "audit_logs") {
        return { insert: vi.fn(async () => ({ error: null })) };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: existing, error: null }),
            select: () => ({
              single: async () => ({ data: existing, error: null }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: { organization_id: "org-1", ...AUTOMATION_DEFAULTS },
              error: null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          options?.onUpdate?.(payload);
          const data = { ...row, ...payload };
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({ data, error: null }),
              }),
            }),
          };
        },
      };
    }),
  };
}

describe("automation settings", () => {
  it("maps snake_case columns to both camel and snake API fields", () => {
    const mapped = mapAutomationSettings({
      organization_id: "org-1",
      auto_shopify_sync: true,
      auto_shipment_creation: true,
      auto_booking: false,
      auto_label_generation: true,
      auto_manifest: true,
      auto_tracking_sync: true,
      auto_shopify_fulfillment: false,
    });
    expect(mapped.autoShopifySync).toBe(true);
    expect(mapped.auto_shopify_sync).toBe(true);
    expect(mapped.autoBooking).toBe(false);
    expect(mapped.auto_booking).toBe(false);
  });

  it("creates a row with service defaults when none exists", async () => {
    const supabase = automationClient({ existing: null });
    const settings = await getAutomationSettings(supabase as never, "org-1");
    expect(settings.autoShopifySync).toBe(AUTOMATION_DEFAULTS.auto_shopify_sync);
    expect(settings.autoManifest).toBe(AUTOMATION_DEFAULTS.auto_manifest);
    expect(settings.autoShopifyFulfillment).toBe(AUTOMATION_DEFAULTS.auto_shopify_fulfillment);
  });

  it("accepts camelCase and snake_case patches", async () => {
    const captured: Record<string, unknown>[] = [];
    const supabase = automationClient({ onUpdate: (payload) => captured.push(payload) });
    await updateAutomationSettings(supabase as never, ctx, { autoBooking: true });
    await updateAutomationSettings(supabase as never, ctx, { auto_shopify_sync: false });
    expect(captured[0]).toEqual({ auto_booking: true });
    expect(captured[1]).toEqual({ auto_shopify_sync: false });
  });

  it("rejects patches with no boolean automation flags", async () => {
    const supabase = automationClient();
    await expect(updateAutomationSettings(supabase as never, ctx, { unknown: true })).rejects.toBeInstanceOf(
      AppError
    );
  });

  it("reports whether auto Shopify sync is enabled", async () => {
    const on = automationClient({
      existing: { ...row, auto_shopify_sync: true },
    });
    const off = automationClient({
      existing: { ...row, auto_shopify_sync: false },
    });
    await expect(isAutoShopifySyncEnabled(on as never, "org-1")).resolves.toBe(true);
    await expect(isAutoShopifySyncEnabled(off as never, "org-1")).resolves.toBe(false);
  });
});

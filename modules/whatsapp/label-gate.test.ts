import { describe, expect, it, vi } from "vitest";
import { canSendIndiaPostWhatsApp } from "@/modules/whatsapp/label-gate";

vi.mock("@/modules/labels/ready", () => ({
  findReadyIndiaPostLabel: vi.fn(async (_client: unknown, _org: string, shipmentId: string) =>
    shipmentId === "ship-ready" ? { id: "label-1", file_path: "a.pdf", file_url: null, status: "READY" } : null
  ),
}));

describe("canSendIndiaPostWhatsApp", () => {
  const supabase = {} as never;

  it("does not send confirmation or processing before a label exists", async () => {
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "order_confirmation", "ship-ready")).resolves.toBe(false);
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "processing", "ship-ready")).resolves.toBe(false);
  });

  it("does not send booked or tracking templates without a generated India Post label", async () => {
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "booked", "ship-open")).resolves.toBe(false);
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "in_transit", null)).resolves.toBe(false);
  });

  it("allows booked and later tracking templates after the label is generated", async () => {
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "booked", "ship-ready")).resolves.toBe(true);
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "in_transit", "ship-ready")).resolves.toBe(true);
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "delivered", "ship-ready")).resolves.toBe(true);
    await expect(canSendIndiaPostWhatsApp(supabase, "org-1", "shipment_delayed", "ship-ready")).resolves.toBe(true);
  });
});

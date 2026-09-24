import { describe, expect, it } from "vitest";
import { updateOrganizationSchema } from "@/lib/api/v1-schemas";
import { organizationLabelSender } from "@/modules/organizations/label-sender";
import { mapOrganizationSettings } from "@/modules/organizations/branding";

describe("organizationLabelSender", () => {
  it("prefers organization identity over pickup and shop", () => {
    const sender = organizationLabelSender(
      {
        name: "Khelon",
        phone: "9876543210",
        line1: "NH 85",
        line2: "Near SO",
        city: "Kolenchery",
        state: "Kerala",
        pincode: "682311",
      },
      {
        name: "Warehouse",
        contact_name: "Pickup desk",
        phone: "9000000000",
        line1: "Old road",
        city: "Kochi",
        pincode: "682001",
      },
      "Shopify Store"
    );
    expect(sender).toEqual({
      name: "Khelon",
      phone: "9876543210",
      line1: "NH 85",
      line2: "Near SO",
      city: "Kolenchery",
      state: "Kerala",
      pincode: "682311",
    });
  });

  it("falls back to pickup then shop then Merchant", () => {
    expect(organizationLabelSender(null, { contact_name: "Desk", line1: "Bay 2" }).name).toBe("Desk");
    expect(organizationLabelSender(null, { line1: "Registered pickup", line2: "NH 85" }).line1).toBe("NH 85");
    expect(organizationLabelSender({ line1: "Registered pickup" }, { line1: "Bay 2" }).line1).toBe("Bay 2");
    expect(organizationLabelSender(null, null, "Priya Stores").name).toBe("Priya Stores");
    expect(organizationLabelSender(null, null, null).name).toBe("Merchant");
    expect(organizationLabelSender(null, null, null).line1).toBe("Registered pickup");
  });
});

describe("updateOrganizationSchema", () => {
  it("accepts Indian phone and 6-digit pincode", () => {
    const parsed = updateOrganizationSchema.parse({
      name: "Khelon",
      phone: "+91 9876543210",
      pincode: "682311",
      line1: "NH 85",
    });
    expect(parsed.phone).toBe("+91 9876543210");
    expect(parsed.pincode).toBe("682311");
  });

  it("clears empty optional fields", () => {
    const parsed = updateOrganizationSchema.parse({ phone: "", line2: "", pincode: "" });
    expect(parsed.phone).toBeNull();
    expect(parsed.line2).toBeNull();
    expect(parsed.pincode).toBeNull();
  });

  it("rejects invalid phone and pincode", () => {
    expect(() => updateOrganizationSchema.parse({ phone: "12345" })).toThrow();
    expect(() => updateOrganizationSchema.parse({ pincode: "68" })).toThrow();
  });
});

describe("mapOrganizationSettings", () => {
  it("exposes logo URL from the organization-assets bucket", () => {
    const previous = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    const mapped = mapOrganizationSettings({
      id: "org-1",
      name: "Khelon",
      logo_path: "org-1/logo-1.png",
    });
    expect(mapped.logoUrl).toBe("https://example.supabase.co/storage/v1/object/public/organization-assets/org-1/logo-1.png");
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous;
  });
});

import { describe, expect, it } from "vitest";
import {
  isApprovedWatiTemplate,
  watiBroadcastName,
  watiNotifyRecipient,
  watiTemplateForEvent,
} from "@/modules/wati/notify";

describe("watiTemplateForEvent", () => {
  it("uses the saved template for each order and shipment event", () => {
    const templates = {
      order_confirmation_template_name: "order_confirm",
      processing_template_name: "order_processing",
      booked_template_name: "order_booked",
      in_transit_template_name: "",
      delivered_template_name: "order_delivered",
    };
    expect(watiTemplateForEvent("order_confirmation", templates)).toBe("order_confirm");
    expect(watiTemplateForEvent("processing", templates)).toBe("order_processing");
    expect(watiTemplateForEvent("booked", templates)).toBe("order_booked");
    expect(watiTemplateForEvent("in_transit", templates)).toBeNull();
    expect(watiTemplateForEvent("delivered", templates)).toBe("order_delivered");
  });
});

describe("isApprovedWatiTemplate", () => {
  it("keeps only approved templates", () => {
    expect(isApprovedWatiTemplate("APPROVED")).toBe(true);
    expect(isApprovedWatiTemplate("approved")).toBe(true);
    expect(isApprovedWatiTemplate("PENDING")).toBe(false);
    expect(isApprovedWatiTemplate("REJECTED")).toBe(false);
  });
});

describe("watiNotifyRecipient", () => {
  it("builds named template params for a shipment", () => {
    const recipient = watiNotifyRecipient({
      customerName: "Priya",
      phone: "9876543210",
      orderNumber: "1001",
      trackingNumber: "CL123456789IN",
      trackingUrl: "https://www.indiapost.gov.in/track?articleid=CL123456789IN",
    });
    expect(recipient?.phone_number).toBe("919876543210");
    expect(recipient?.custom_params).toEqual(
      expect.arrayContaining([
        { name: "customer_name", value: "Priya" },
        { name: "order_number", value: "1001" },
        { name: "tracking_number", value: "CL123456789IN" },
        { name: "tracking_id", value: "CL123456789IN" },
        { name: "tracking_url", value: "https://www.indiapost.gov.in/track?articleid=CL123456789IN" },
        { name: "tracking_link", value: "https://www.indiapost.gov.in/track?articleid=CL123456789IN" },
      ])
    );
  });

  it("skips shipments without a WhatsApp number", () => {
    expect(watiNotifyRecipient({ phone: "123" })).toBeNull();
  });
});

describe("watiBroadcastName", () => {
  it("is unique per event and article", () => {
    expect(watiBroadcastName("booked", "CL123456789IN")).toBe("postbus_booked_CL123456789IN");
    expect(watiBroadcastName("order_confirmation", "#1042")).toBe("postbus_order_confirmation_#1042");
  });
});

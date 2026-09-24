import { describe, expect, it } from "vitest";
import {
  isApprovedWatiTemplate,
  isApprovedWatiUtilityTemplate,
  watiBroadcastName,
  watiNotifyRecipient,
  watiTemplateCustomParams,
  watiTemplateForEvent,
  watiValuesForPlaceholders,
} from "@/modules/wati/notify";
import { isDuplicateWatiNotifyJob, resolveWatiTrackingUrl } from "@/modules/wati/send";

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

describe("isDuplicateWatiNotifyJob", () => {
  it("treats the same order processing job as already queued", () => {
    expect(
      isDuplicateWatiNotifyJob(
        [{ entity_id: "ord-1", progress: { event: "processing", orderId: "ord-1" } }],
        "processing",
        { orderId: "ord-1" }
      )
    ).toBe(true);
    expect(
      isDuplicateWatiNotifyJob(
        [{ entity_id: "ship-1", progress: { event: "processing", shipmentId: "ship-1" } }],
        "processing",
        { orderId: "ord-1" }
      )
    ).toBe(false);
  });
});

describe("isApprovedWatiTemplate", () => {
  it("keeps only approved templates", () => {
    expect(isApprovedWatiTemplate("APPROVED")).toBe(true);
    expect(isApprovedWatiTemplate("approved")).toBe(true);
    expect(isApprovedWatiTemplate("PENDING")).toBe(false);
    expect(isApprovedWatiTemplate("REJECTED")).toBe(false);
  });

  it("keeps only approved Utility templates", () => {
    expect(isApprovedWatiUtilityTemplate("APPROVED", "UTILITY")).toBe(true);
    expect(isApprovedWatiUtilityTemplate("approved", "utility")).toBe(true);
    expect(isApprovedWatiUtilityTemplate("APPROVED", "MARKETING")).toBe(false);
    expect(isApprovedWatiUtilityTemplate("APPROVED", "AUTHENTICATION")).toBe(false);
    expect(isApprovedWatiUtilityTemplate("PENDING", "UTILITY")).toBe(false);
  });
});

describe("watiNotifyRecipient", () => {
  it("builds named template params for a shipment", () => {
    const recipient = watiNotifyRecipient({
      customerName: "Priya",
      phone: "9876543210",
      orderNumber: "1001",
      trackingNumber: "CL123456789IN",
      trackingUrl: "https://priya.postbus.in/?tracking=CL123456789IN",
    });
    expect(recipient?.phone_number).toBe("919876543210");
    expect(recipient?.custom_params).toEqual(
      expect.arrayContaining([
        { name: "customer_name", value: "Priya" },
        { name: "order_number", value: "1001" },
        { name: "tracking_number", value: "CL123456789IN" },
        { name: "tracking_id", value: "CL123456789IN" },
        { name: "tracking_url", value: "https://priya.postbus.in/?tracking=CL123456789IN" },
        { name: "tracking_link", value: "https://priya.postbus.in/?tracking=CL123456789IN" },
      ])
    );
  });

  it("skips shipments without a WhatsApp number", () => {
    expect(watiNotifyRecipient({ phone: "123" })).toBeNull();
  });
});

describe("watiValuesForPlaceholders", () => {
  const shipment = {
    customerName: "Priya",
    shopName: "Aurimo",
    orderNumber: "1001",
    trackingUrl: "https://track.example/1001",
  };

  it("fills confirmation, processing, and tracking templates in placeholder order", () => {
    expect(
      watiValuesForPlaceholders(
        "Hi {{1}},\nThank you for your purchase from {{2}}.\nYour order {{3}} has been confirmed.",
        shipment
      )
    ).toEqual(["Priya", "Aurimo", "1001"]);
    expect(
      watiValuesForPlaceholders("Hi {{1}},\nYour order {{2}} is currently being processed.", shipment)
    ).toEqual(["Priya", "1001"]);
    expect(
      watiValuesForPlaceholders(
        "Hi, {{1}},\nYour order from {{2}} has been packed.\nTrack your shipment here {{3}}",
        shipment
      )
    ).toEqual(["Priya", "Aurimo", "https://track.example/1001"]);
  });

  it("sends numbered placeholders and the template parameter names", () => {
    expect(
      watiTemplateCustomParams(shipment, {
        body: "Hi {{1}}, your order {{2}} is confirmed.",
        customParams: [{ name: "customer_name" }, { name: "order_number" }],
      })
    ).toEqual(
      expect.arrayContaining([
        { name: "customer_name", value: "Priya" },
        { name: "order_number", value: "1001" },
        { name: "1", value: "Priya" },
        { name: "2", value: "1001" },
      ])
    );
  });
});

describe("resolveWatiTrackingUrl", () => {
  it("prefers the published customer tracking page", () => {
    expect(
      resolveWatiTrackingUrl("CL123456789IN", {
        status: "PUBLISHED",
        publicUrl: "https://priya.postbus.in",
      })
    ).toBe("https://priya.postbus.in/?tracking=CL123456789IN");
  });

  it("falls back to India Post when the page is not published", () => {
    expect(resolveWatiTrackingUrl("CL123456789IN", { status: "DRAFT", publicUrl: "https://priya.postbus.in" })).toBe(
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?articleid=CL123456789IN"
    );
    expect(resolveWatiTrackingUrl("CL123456789IN", null)).toBe(
      "https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?articleid=CL123456789IN"
    );
  });
});

describe("watiBroadcastName", () => {
  it("is unique per event and article", () => {
    expect(watiBroadcastName("booked", "CL123456789IN")).toBe("postbus_booked_CL123456789IN");
    expect(watiBroadcastName("order_confirmation", "#1042")).toBe("postbus_order_confirmation_#1042");
  });
});

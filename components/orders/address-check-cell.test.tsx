import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingErrorCell } from "@/components/orders/address-check-cell";
import { collectErrorFacts } from "@/modules/orders/error-facts";
import type { OrderRecord } from "@/types/api";

const PHONE =
  "The booking did not complete because the mobile number provided is not a valid 10-digit Indian number starting with 6, 7, 8, or 9.";

const order = {
  id: "ord-1",
  orderNumber: "2612",
  shippingAddress: {
    address_validation_status: "NEEDS_REVIEW",
    address_validation_errors: [{ message: PHONE }],
  },
  shipment: {
    status: "FAILED",
    last_error: PHONE,
    last_error_code: "VALIDATION_ERROR",
    length_cm: 20,
    width_cm: 10,
    height_cm: 5,
    weight_grams: 150,
  },
} as OrderRecord;

const facts = collectErrorFacts(order);
const finalStatus = {
  status: "Address error",
  summary: PHONE,
  source: "ai" as const,
  kind: "address" as const,
  facts,
};

function html(aiAddressCheck: boolean) {
  return renderToStaticMarkup(
    <BookingErrorCell order={order} finalStatus={finalStatus} aiAddressCheck={aiAddressCheck} onAction={() => undefined} />
  );
}

describe("BookingErrorCell recovery", () => {
  it("does not hide an unknown India Post outcome behind Booking…", () => {
    const markup = renderToStaticMarkup(
      <BookingErrorCell
        order={
          {
            id: "ord-recovery",
            orderNumber: "2637",
            shipment: {
              status: "RECOVERY_REQUIRED",
              last_error: "India Post booking outcome is unknown after the request was sent.",
              last_error_code: "CEPT_UNKNOWN",
              length_cm: 20,
              width_cm: 10,
              height_cm: 5,
              weight_grams: 150,
            },
          } as OrderRecord
        }
        onAction={() => undefined}
      />
    );
    expect(markup).not.toContain("Booking…");
    expect(markup).toContain("Force book");
    expect(markup).toContain("outcome is unknown");
  });

  it("keeps a fresh Direct Book on Booking… and offers retry once it has stalled", () => {
    const shipment = {
      status: "QUEUED",
      length_cm: 20,
      width_cm: 10,
      height_cm: 5,
      weight_grams: 150,
    };
    const fresh = renderToStaticMarkup(
      <BookingErrorCell
        order={{ id: "ord-live", orderNumber: "2701", shipment: { ...shipment, updated_at: new Date().toISOString() } } as OrderRecord}
        onAction={() => undefined}
      />
    );
    expect(fresh).toContain("Booking…");
    expect(fresh).not.toContain("Retry booking");

    const stalled = renderToStaticMarkup(
      <BookingErrorCell
        order={
          {
            id: "ord-stale",
            orderNumber: "2702",
            shipment: { ...shipment, updated_at: new Date(Date.now() - 3 * 60 * 1000).toISOString() },
          } as OrderRecord
        }
        onAction={() => undefined}
      />
    );
    expect(stalled).not.toContain("Booking…");
    expect(stalled).toContain("Retry booking");
    expect(stalled).toContain("Booking stalled");

    const parkedBarcode = renderToStaticMarkup(
      <BookingErrorCell
        order={
          {
            id: "ord-barcode",
            orderNumber: "2703",
            shipment: {
              ...shipment,
              barcode: "ET214330016IN",
              updated_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
            },
          } as OrderRecord
        }
        onAction={() => undefined}
      />
    );
    expect(parkedBarcode).toContain("Force book");
    expect(parkedBarcode).not.toContain("Retry booking");
  });
});

describe("BookingErrorCell AI address check", () => {
  it("shows the AI mark and Fix address and book when the workspace toggle is on", () => {
    const markup = html(true);
    expect(markup).toContain("Address error");
    expect(markup).toContain(">AI<");
    expect(markup).toContain("Fix address and book");
    expect(markup).toContain("Address lines are corrected, then the booking is sent again.");
    expect(markup).not.toMatch(/>Fix address</);
  });

  it("hides the AI mark, rewrite, and auto-book action when the workspace toggle is off", () => {
    const markup = html(false);
    expect(markup).toContain("Booking failed");
    expect(markup).toContain(PHONE);
    expect(markup).not.toContain("Address error");
    expect(markup).not.toContain(">AI<");
    expect(markup).toContain("Fix address");
    expect(markup).not.toContain("Fix address and book");
    expect(markup).not.toContain("Address lines are corrected, then the booking is sent again.");
  });
});

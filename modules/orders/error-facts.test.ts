import { describe, expect, it } from "vitest";
import {
  collectErrorFacts,
  errorActionHint,
  errorQuickAction,
  finalErrorFromFacts,
  isUnknownBookingError,
  merchantProviderError,
  resolveDisplayError,
} from "@/modules/orders/error-facts";
import { parseErrorStatusContent } from "@/modules/orders/error-status";

describe("order error status", () => {
  it("keeps a provider failure ahead of address and parcel facts", () => {
    const facts = collectErrorFacts({
      payment_status: "UNPAID",
      shipment: {
        status: "FAILED",
        last_error: "Duplicate article barcode",
        last_error_code: "DUPLICATE",
        length_cm: 0,
        width_cm: 0,
        height_cm: 0,
      },
      shippingAddress: {
        address_validation_status: "INVALID",
        address_validation_errors: [{ message: "PIN code was not found." }],
      },
    });
    expect(facts.map((fact) => fact.kind)).toEqual(
      expect.arrayContaining(["provider", "payment", "address", "parcel"])
    );
    const finalStatus = finalErrorFromFacts(facts);
    expect(finalStatus?.status).toBe("Booking failed");
    expect(finalStatus?.summary).toContain("Duplicate article barcode");
    expect(finalStatus?.summary).toContain("Payment is UNPAID");
    expect(finalStatus?.summary).toContain("PIN code was not found");
  });

  it("hides the read-only code crash behind the timeout message", () => {
    const raw = "Cannot set property code of #<DOMException> which has only a getter";
    expect(merchantProviderError(raw)).toMatch(/timed out/i);
    expect(merchantProviderError(raw)).not.toMatch(/only a getter/);
    const [fact] = collectErrorFacts({
      shipment: {
        status: "FAILED",
        last_error: raw,
        last_error_code: "PROVIDER_ERROR",
        length_cm: 10,
        width_cm: 10,
        height_cm: 10,
        weight_grams: 200,
      },
    });
    expect(fact?.message).toMatch(/timed out/i);
    expect(isUnknownBookingError({ last_error: raw, last_error_code: "PROVIDER_ERROR" })).toBe(true);
  });

  it("treats CEPT_UNKNOWN as a force-book error", () => {
    expect(
      isUnknownBookingError({
        last_error_code: "CEPT_UNKNOWN",
        last_error: "India Post booking outcome is unknown after the request was sent.",
      })
    ).toBe(true);
    expect(isUnknownBookingError({ last_error_code: "VALIDATION_ERROR" })).toBe(false);
  });

  it("does not invent an error for a booked shipment", () => {
    expect(
      collectErrorFacts({
        shipment: { status: "BOOKED", last_error: "old", length_cm: 0, width_cm: 0, height_cm: 0 },
        payment_status: "UNPAID",
      })
    ).toEqual([]);
  });

  it("reads the model JSON and ignores unknown orders", () => {
    const parsed = parseErrorStatusContent(
      JSON.stringify({
        orders: [
          { orderId: "a", status: "Booking failed", summary: "India Post rejected the barcode." },
          { orderId: "missing", status: "Nope", summary: "Ignore." },
        ],
      }),
      ["a"]
    );
    expect(parsed.get("a")?.summary).toBe("India Post rejected the barcode.");
    expect(parsed.has("missing")).toBe(false);
  });

  it("keeps the exact provider code apart from the message", () => {
    const [fact] = collectErrorFacts({
      shipment: { status: "FAILED", last_error: "Invalid PIN", last_error_code: "INVALID_PINCODE", length_cm: 10, width_cm: 10, height_cm: 10, weight_grams: 200 },
    });
    expect(fact).toEqual({ kind: "provider", message: "Invalid PIN", code: "INVALID_PINCODE" });
  });

  it("clears a stale parcel error once the row has a saved size and weight", () => {
    const stale = {
      status: "Parcel size missing",
      summary: "Parcel length, width, and height are missing.",
      source: "ai" as const,
      facts: [{ kind: "parcel" as const, message: "Parcel length, width, and height are missing.", code: "PARCEL_SIZE" }],
    };
    const row = { shipment: { status: "DRAFT", length_cm: 20, width_cm: 15, height_cm: 10, weight_grams: 500 } };
    expect(resolveDisplayError(row, stale)).toBeNull();
  });

  it("shows only the parcel part that is still missing", () => {
    const error = resolveDisplayError({ shipment: { status: "DRAFT", length_cm: 20, width_cm: 15, height_cm: 10 } });
    expect(error?.status).toBe("Weight missing");
    expect(error && errorQuickAction(error, false)).toBe("parcel");
  });

  it("keeps the AI wording only while its facts still match the row", () => {
    const row = { shipment: { status: "FAILED", last_error: "Duplicate barcode", last_error_code: "DUPLICATE", length_cm: 1, width_cm: 1, height_cm: 1, weight_grams: 100 } };
    const facts = collectErrorFacts(row);
    const ai = { status: "Booking failed", summary: "India Post rejected a duplicate barcode.", source: "ai" as const, facts };
    expect(resolveDisplayError(row, ai)?.source).toBe("ai");
    const stale = { ...ai, facts: [...facts, { kind: "parcel" as const, message: "Parcel weight is missing.", code: "PARCEL_WEIGHT" }] };
    expect(resolveDisplayError(row, stale)?.source).toBe("rules");
  });

  it("keeps invoice facts that only the server can see", () => {
    const row = { shipment: { status: "DRAFT", length_cm: 1, width_cm: 1, height_cm: 1, weight_grams: 100 } };
    const server = { status: "Invoice error", summary: "GST missing.", facts: [{ kind: "invoice" as const, message: "GST missing." }] };
    const error = resolveDisplayError(row, server);
    expect(error?.kind).toBe("invoice");
    expect(error && errorQuickAction(error, false)).toBe("open");
  });

  it("offers force book only for an unknown booking outcome", () => {
    const error = resolveDisplayError({ shipment: { status: "FAILED", last_error_code: "CEPT_UNKNOWN", length_cm: 1, width_cm: 1, height_cm: 1, weight_grams: 1 } });
    expect(error && errorQuickAction(error, true)).toBe("force");
  });

  const fullParcel = { length_cm: 15, width_cm: 10, height_cm: 5, weight_grams: 2100 };

  it("retries at once when the parcel was fixed after a parcel failure", () => {
    const error = resolveDisplayError({
      shipment: {
        status: "FAILED",
        last_error_code: "VALIDATION_ERROR",
        last_error: "Parcel length, breadth and height are required and must be within India Post limits.",
        ...fullParcel,
      },
    });
    expect(error && errorQuickAction(error, false)).toBe("retry");
    expect(error && errorActionHint(error, "retry")).toMatch(/Parcel updated/);
  });

  it("asks for the parcel while it is still incomplete", () => {
    const error = resolveDisplayError({
      shipment: {
        status: "FAILED",
        last_error_code: "VALIDATION_ERROR",
        last_error: "Parcel length, breadth and height are required and must be within India Post limits.",
        length_cm: 0,
        width_cm: 0,
        height_cm: 0,
        weight_grams: 2100,
      },
    });
    expect(error && errorQuickAction(error, false)).toBe("parcel");
  });

  it("sends address failures to the address check and temporary ones to retry", () => {
    const address = resolveDisplayError({
      shipment: { status: "FAILED", last_error_code: "INVALID_PINCODE", last_error: "Receiver PIN not serviceable.", ...fullParcel },
    });
    expect(address && errorQuickAction(address, false)).toBe("review");
    const city = resolveDisplayError({
      shipment: {
        status: "FAILED",
        last_error_code: "INVALID_ADDRESS",
        last_error: "The city does not match the post offices for the provided PIN code.",
        ...fullParcel,
      },
    });
    expect(city && errorQuickAction(city, false)).toBe("autocorrect");
    const transient = resolveDisplayError({
      shipment: { status: "FAILED", last_error_code: "VALIDATION_ERROR", last_error: "Unable to fetch India Post offices. Please try again.", ...fullParcel },
    });
    expect(transient && errorQuickAction(transient, false)).toBe("retry");
  });

  it("shows an unknown destination PIN as an invalid postal PIN and asks for a manual fix", () => {
    const wrapped = "Please provide proper data for tariff calculation - Destination pincode 560823 not found";
    expect(merchantProviderError(wrapped)).toBe("560823 is not a valid postal PIN code");
    expect(merchantProviderError("Origin pincode 110001 not found")).toBe("110001 is not a valid postal PIN code");
    const error = resolveDisplayError({
      shipment: {
        status: "FAILED",
        last_error_code: "VALIDATION_ERROR",
        last_error: wrapped,
        ...fullParcel,
      },
    });
    expect(error?.summary).toContain("560823 is not a valid postal PIN code");
    expect(error?.facts[0]).toMatchObject({
      kind: "provider",
      code: "INVALID_PINCODE",
      message: "560823 is not a valid postal PIN code",
    });
    expect(error && errorQuickAction(error, false)).toBe("review");
  });

  it("books again after an address line is shorter or longer than India Post allows", () => {
    const error = resolveDisplayError({
      shipment: {
        status: "FAILED",
        last_error_code: "VALIDATION_ERROR",
        last_error: "receiver_add_line_1 must be between 3 and 80 characters.",
        ...fullParcel,
      },
    });
    expect(error && errorQuickAction(error, false)).toBe("autocorrect");
    expect(error && errorActionHint(error, "autocorrect")).toMatch(/booking is sent again/);
  });

  it("treats an invalid mobile number as an address action that can be autocorrected", () => {
    const phone =
      "The booking did not complete because the mobile number provided is not a valid 10-digit Indian number starting with 6, 7, 8, or 9.";
    const error = resolveDisplayError({
      shippingAddress: {
        address_validation_status: "NEEDS_REVIEW",
        address_validation_errors: [{ message: phone }],
      },
      shipment: {
        status: "FAILED",
        last_error: phone,
        last_error_code: "VALIDATION_ERROR",
        ...fullParcel,
      },
    });
    expect(error?.facts.some((fact) => fact.kind === "address")).toBe(true);
    expect(error && errorQuickAction(error, false)).toBe("autocorrect");
  });
});

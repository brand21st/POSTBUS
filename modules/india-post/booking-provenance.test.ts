import { describe, expect, it } from "vitest";
import {
  duplicateBarcodeBookingBlock,
  metadataWithFirstBarcodeProof,
  trustedFirstBarcodeProof,
} from "@/modules/india-post/booking-provenance";

const ISSUED = "2026-10-31T06:00:00.000Z";
const BARCODE = "ET214330016IN";

function proved() {
  return {
    id: "ship-1",
    organization_id: "org-1",
    barcode: BARCODE,
    created_at: ISSUED,
    metadata: metadataWithFirstBarcodeProof(null, {
      shipmentId: "ship-1",
      organizationId: "org-1",
      barcode: BARCODE,
      issuedAt: ISSUED,
    }),
  };
}

describe("barcode provenance", () => {
  it("accepts a proof written with the shipment", () => {
    expect(trustedFirstBarcodeProof(proved())).toBe(true);
  });

  it("rejects a proof dated after the shipment was created", () => {
    const row = proved();
    row.created_at = "2026-10-01T06:00:00.000Z";
    expect(trustedFirstBarcodeProof(row)).toBe(false);
  });

  it("rejects a merchant-forged signature", () => {
    const row = proved();
    row.metadata = {
      bookingBarcodeProof: { barcode: BARCODE, issuedAt: ISSUED, signature: "forged" },
    };
    expect(trustedFirstBarcodeProof(row)).toBe(false);
  });

  it("rejects proof after a submit intent exists", () => {
    const row = proved();
    row.metadata = { ...row.metadata, ceptSubmitIntentAt: ISSUED };
    expect(trustedFirstBarcodeProof(row)).toBe(false);
  });

  it("binds the signature to the shipment, organization, and barcode", () => {
    const row = proved();
    expect(trustedFirstBarcodeProof({ ...row, id: "ship-2" })).toBe(false);
    expect(trustedFirstBarcodeProof({ ...row, organization_id: "org-2" })).toBe(false);
    expect(trustedFirstBarcodeProof({ ...row, barcode: "ET214330026IN" })).toBe(false);
  });

  it("keeps a pending proof valid when the previous encryption key is retained", () => {
    const signingKey = process.env.INTEGRATION_ENCRYPTION_KEY || "dev-only-change-me-32-bytes-min!!";
    const previous = process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
    const current = process.env.INTEGRATION_ENCRYPTION_KEY;
    const row = proved();
    try {
      process.env.INTEGRATION_ENCRYPTION_KEY = "rotated-integration-key-32-bytes!!";
      expect(trustedFirstBarcodeProof(row)).toBe(false);
      process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = signingKey;
      expect(trustedFirstBarcodeProof(row)).toBe(true);
    } finally {
      if (current === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
      else process.env.INTEGRATION_ENCRYPTION_KEY = current;
      if (previous === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS;
      else process.env.INTEGRATION_ENCRYPTION_KEY_PREVIOUS = previous;
    }
  });

  it("blocks a second import when the barcode is already on a shipment", () => {
    expect(duplicateBarcodeBookingBlock({ id: "ship-1" })).toMatch(/not booked again/i);
    expect(duplicateBarcodeBookingBlock(null)).toBeNull();
  });

  it("blocks the same uploaded barcode on a second file", () => {
    expect(duplicateBarcodeBookingBlock({ id: "existing-shipment" })).toBeTruthy();
  });
});

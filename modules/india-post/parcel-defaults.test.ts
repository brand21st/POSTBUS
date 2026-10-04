import { describe, expect, it } from "vitest";
import { mapShipmentToArticle } from "@/modules/india-post/article-mapper";
import { validateIndiaPostArticle } from "@/modules/india-post/article-validator";
import {
  FALLBACK_PARCEL_HEIGHT_CM,
  FALLBACK_PARCEL_LENGTH_CM,
  FALLBACK_PARCEL_WEIGHT_G,
  FALLBACK_PARCEL_WIDTH_CM,
  applyWorkspaceParcelDefaults,
  parcelDefaultsFromConnection,
  parcelDefaultsValidationError,
  parseParcelDefaultsInput,
} from "@/modules/india-post/parcel-defaults";

function baseDraft(overrides: Record<string, unknown> = {}) {
  return mapShipmentToArticle({
    orderId: "ord-1",
    orderNumber: "#10025",
    serviceCode: "SP_INLAND_PARCEL",
    customerId: "1788590988",
    contractId: "41793509",
    barcode: "ET214330016IN",
    officeId: "22660454",
    originPin: "682311",
    weightGrams: 0,
    lengthCm: 0,
    widthCm: 0,
    heightCm: 0,
    senderName: "Kerlaz",
    senderCompany: "Kerlaz Stores",
    senderLine1: "Kolenchery road",
    senderCity: "Ernakulam",
    senderState: "Kerala",
    senderPin: "682311",
    senderMobile: "9876543210",
    receiverName: "Vishnu Priya",
    receiverLine1: "Sulakkarai street",
    receiverCity: "Virudhunagar",
    receiverState: "Tamil Nadu",
    receiverPin: "626003",
    receiverMobile: "9944388249",
    paymentMode: "PREPAID",
    strictDimensions: true,
    ...overrides,
  });
}

describe("workspace parcel defaults", () => {
  it("reads connection columns in camel or snake case", () => {
    expect(
      parcelDefaultsFromConnection({
        default_length_cm: 20,
        defaultWidthCm: 15,
        default_height_cm: 10,
        default_weight_grams: 500,
      })
    ).toEqual({ lengthCm: 20, widthCm: 15, heightCm: 10, weightGrams: 500 });
  });

  it("rejects out-of-range settings values", () => {
    expect(parcelDefaultsValidationError({ lengthCm: 10, widthCm: 15, heightCm: 10, weightGrams: 100 })).toMatch(
      /length/i
    );
    expect(parcelDefaultsValidationError({ lengthCm: 20, widthCm: 5, heightCm: 10, weightGrams: 100 })).toMatch(
      /width/i
    );
    expect(parcelDefaultsValidationError({ lengthCm: 20, widthCm: 15, heightCm: 0.5, weightGrams: 100 })).toMatch(
      /height/i
    );
    expect(parcelDefaultsValidationError({ lengthCm: 20, widthCm: 15, heightCm: 10, weightGrams: null })).toBeNull();
    expect(parcelDefaultsValidationError({ lengthCm: 20, widthCm: 15, heightCm: 10, weightGrams: 40000 })).toMatch(
      /weight/i
    );
  });

  it("treats blank PATCH body as unset defaults", () => {
    expect(parseParcelDefaultsInput({ lengthCm: "", widthCm: null, heightCm: undefined, weightGrams: "" })).toEqual({
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      weightGrams: null,
    });
  });

  it("fills empty parcel size and weight from workspace settings", () => {
    const filled = applyWorkspaceParcelDefaults(baseDraft(), {
      lengthCm: 25,
      widthCm: 18,
      heightCm: 12,
      weightGrams: 750,
    });
    expect(filled.lengthCm).toBe(25);
    expect(filled.widthCm).toBe(18);
    expect(filled.heightCm).toBe(12);
    expect(filled.weightGrams).toBe(750);
    expect(validateIndiaPostArticle(filled)).toEqual([]);
  });

  it("falls back to India Post minima when settings are empty", () => {
    const filled = applyWorkspaceParcelDefaults(baseDraft(), {
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      weightGrams: null,
    });
    expect(filled.lengthCm).toBe(FALLBACK_PARCEL_LENGTH_CM);
    expect(filled.widthCm).toBe(FALLBACK_PARCEL_WIDTH_CM);
    expect(filled.heightCm).toBe(FALLBACK_PARCEL_HEIGHT_CM);
    expect(filled.weightGrams).toBe(FALLBACK_PARCEL_WEIGHT_G);
    expect(validateIndiaPostArticle(filled)).toEqual([]);
  });

  it("does not overwrite merchant-entered size or weight", () => {
    const filled = applyWorkspaceParcelDefaults(
      baseDraft({ lengthCm: 30, widthCm: 20, heightCm: 15, weightGrams: 900 }),
      { lengthCm: 14, widthCm: 9, heightCm: 1, weightGrams: 100 }
    );
    expect(filled.lengthCm).toBe(30);
    expect(filled.widthCm).toBe(20);
    expect(filled.heightCm).toBe(15);
    expect(filled.weightGrams).toBe(900);
  });

  it("does not invent document dimensions", () => {
    const filled = applyWorkspaceParcelDefaults(baseDraft({ serviceCode: "SP_INLAND_DOC", weightGrams: 200 }), {
      lengthCm: 25,
      widthCm: 18,
      heightCm: 12,
      weightGrams: 750,
    });
    expect(filled.weightGrams).toBe(200);
    expect(filled.lengthCm).toBe(0);
    expect(filled.widthCm).toBe(0);
    expect(filled.heightCm).toBe(0);
  });
});

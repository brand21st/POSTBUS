import { describe, expect, it } from "vitest";
import {
  dimensionSourceLabel,
  dimsFromMetafieldEntries,
  formatParcelSize,
  resolveShipmentDimensions,
  shopifyDimensionToCm,
  unitFitsPackage,
} from "@/modules/shopify/dimensions";
import { shopifyParcelFromLineItems, shopifyResolvedShipmentDims } from "@/modules/shopify/orders";

describe("shopify dimension import", () => {
  it("keeps a measured product box in centimeters", () => {
    expect(
      shopifyResolvedShipmentDims([
        { title: "Box", quantity: 1, unfulfilled_quantity: 1, grams: 400, length_cm: 30, width_cm: 20, height_cm: 10 },
      ])
    ).toMatchObject({ lengthCm: 30, widthCm: 20, heightCm: 10, dimensionSource: "shopify" });
    expect(formatParcelSize(30, 20, 10)).toBe("30 × 20 × 10 cm");
    expect(dimensionSourceLabel("shopify")).toBe("Source: Shopify product measurement");
  });

  it("keeps weight and shows no size when dimensions are absent", () => {
    expect(shopifyParcelFromLineItems([{ title: "Kurta", quantity: 1, unfulfilled_quantity: 1, grams: 500 }])).toEqual({
      weightGrams: 500,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
    });
    expect(formatParcelSize(null, null, null)).toBe("No size");
  });

  it("reads variant and product dimension metafields", () => {
    expect(
      dimsFromMetafieldEntries([
        { namespace: "custom", key: "length", value: '{"value":12,"unit":"INCHES"}' },
        { namespace: "custom", key: "width", value: "20", type: "number_decimal" },
        { namespace: "custom", key: "height", value: "8 cm" },
      ])
    ).toEqual({ lengthCm: 30.48, widthCm: 20, heightCm: 8 });
    expect(
      dimsFromMetafieldEntries([
        { namespace: "facts", key: "package_size", value: "30 x 20 x 10 cm" },
      ])
    ).toEqual({ lengthCm: 30, widthCm: 20, heightCm: 10 });
  });

  it("uses the only configured package", () => {
    expect(
      resolveShipmentDimensions({
        units: [{ quantity: 1 }],
        packages: [{ id: "pkg-1", name: "Mailer", lengthCm: 25, widthCm: 18, heightCm: 6 }],
      })
    ).toMatchObject({ source: "postbus_package", packageName: "Mailer", lengthCm: 25 });
    expect(dimensionSourceLabel("postbus_package")).toBe("Source: PostBus");
  });

  it("does not guess among several packages", () => {
    expect(
      resolveShipmentDimensions({
        units: [{ quantity: 2 }],
        packages: [
          { id: "a", name: "Small", lengthCm: 20, widthCm: 15, heightCm: 10 },
          { id: "b", name: "Large", lengthCm: 40, widthCm: 30, heightCm: 20 },
        ],
      })
    ).toBeNull();
  });

  it("requires a manual package when several products or quantities are in the shipment", () => {
    const packages = [
      { id: "small", name: "Small", lengthCm: 20, widthCm: 15, heightCm: 10 },
      { id: "large", name: "Large", lengthCm: 40, widthCm: 30, heightCm: 20 },
    ];
    expect(
      resolveShipmentDimensions({
        units: [
          { quantity: 1, lengthCm: 20, widthCm: 10, heightCm: 8 },
          { quantity: 1, lengthCm: 30, widthCm: 12, heightCm: 4 },
        ],
        packages,
      })
    ).toBeNull();
    expect(
      resolveShipmentDimensions({
        units: [{ quantity: 3, lengthCm: 20, widthCm: 15, heightCm: 10 }],
        packages: [{ id: "deep", name: "Deep", lengthCm: 20, widthCm: 15, heightCm: 30 }],
        defaultPackage: { lengthCm: 40, widthCm: 30, heightCm: 20 },
      })
    ).toBeNull();
    expect(
      resolveShipmentDimensions({
        units: [
          { quantity: 1 },
          { quantity: 1 },
        ],
        packages: [{ id: "only", name: "Only", lengthCm: 30, widthCm: 20, heightCm: 10 }],
      })
    ).toBeNull();
  });

  it("converts Shopify measurement units into centimeters and rejects unknown units", () => {
    expect(shopifyDimensionToCm(10, "mm")).toBe(1);
    expect(shopifyDimensionToCm(1, "m")).toBe(100);
    expect(shopifyDimensionToCm(1, "ft")).toBe(30.48);
    expect(shopifyDimensionToCm(2, "in")).toBe(5.08);
    expect(shopifyDimensionToCm(10, "furlongs")).toBeNull();
    expect(shopifyDimensionToCm(-5, "cm")).toBeNull();
    expect(shopifyDimensionToCm("nope")).toBeNull();
  });

  it("labels the merchant default package and does not call it Shopify", () => {
    expect(
      shopifyResolvedShipmentDims([{ title: "Kurta", quantity: 1, unfulfilled_quantity: 1, grams: 200 }], {
        lengthCm: 22,
        widthCm: 16,
        heightCm: 11,
        weightGrams: 400,
      })
    ).toMatchObject({ dimensionSource: "postbus_default" });
    expect(dimensionSourceLabel("postbus_default")).toBe("Source: PostBus Default Package");
  });

  it("rejects a package that cannot contain the measured item", () => {
    expect(unitFitsPackage({ lengthCm: 40, widthCm: 10, heightCm: 10 }, { lengthCm: 20, widthCm: 20, heightCm: 20 })).toBe(
      false
    );
  });
});

import { describe, expect, it } from "vitest";
import { selectableIndiaPostServices } from "@/modules/india-post/contracts";

describe("selectableIndiaPostServices", () => {
  it("lists saved India Post service contracts with labels", () => {
    expect(
      selectableIndiaPostServices({
        defaultServiceCode: "BUSINESS_PARCEL",
        contracts: [
          {
            serviceCode: "BUSINESS_PARCEL",
            contractId: "41793509",
            isDefault: true,
            isActive: true,
            label: "Business Parcel",
          },
          {
            serviceCode: "SP_INLAND_PARCEL",
            contractId: "111",
            isDefault: false,
            isActive: true,
            label: "Speed Post parcel",
          },
          { serviceCode: "SP_INLAND_DOC", contractId: "", isActive: true },
        ],
      })
    ).toEqual([
      { code: "BUSINESS_PARCEL", label: "Business Parcel", isDefault: true },
      { code: "SP_INLAND_PARCEL", label: "Speed Post parcel", isDefault: false },
    ]);
  });

  it("falls back to known India Post services when no contract is saved", () => {
    const options = selectableIndiaPostServices({ contracts: [], defaultServiceCode: "SP_INLAND_PARCEL" });
    expect(options.map((item) => item.code)).toEqual([
      "SP_INLAND_PARCEL",
      "SP_INLAND_DOC",
      "BUSINESS_PARCEL",
    ]);
    expect(options.find((item) => item.isDefault)?.code).toBe("SP_INLAND_PARCEL");
  });
});

import { describe, expect, it } from "vitest";
import { selectableIndiaPostServices, hideWorkspaceBookingToggle, parcelServiceToggleOptions } from "@/modules/india-post/contracts";

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
          { serviceCode: "SP_INLAND_DOC", contractId: "999", isActive: true },
        ],
      })
    ).toEqual([
      { code: "BUSINESS_PARCEL", label: "Business Parcel", isDefault: true },
      { code: "SP_INLAND_PARCEL", label: "Speed Post parcel", isDefault: false },
    ]);
  });

  it("falls back to known India Post services when no contract is saved", () => {
    const options = selectableIndiaPostServices({ contracts: [], defaultServiceCode: "SP_INLAND_PARCEL" });
    expect(options.map((item) => item.code)).toEqual(["SP_INLAND_PARCEL", "BUSINESS_PARCEL"]);
    expect(options.find((item) => item.isDefault)?.code).toBe("SP_INLAND_PARCEL");
    expect(hideWorkspaceBookingToggle({ contracts: [] })).toBe(false);
  });

  it("hides the workspace toggle when only one contract ID is saved", () => {
    const config = {
      defaultServiceCode: "BUSINESS_PARCEL",
      contracts: [{ serviceCode: "BUSINESS_PARCEL", contractId: "41793509", isDefault: true, isActive: true }],
    };
    expect(selectableIndiaPostServices(config).map((item) => item.code)).toEqual(["BUSINESS_PARCEL"]);
    expect(hideWorkspaceBookingToggle(config)).toBe(true);
    expect(parcelServiceToggleOptions(config)).toEqual([
      { value: "BUSINESS_PARCEL", label: "BP", title: "Business Parcel" },
    ]);
  });

  it("keeps both parcel options when two contract IDs are saved", () => {
    const config = {
      defaultServiceCode: "SP_INLAND_PARCEL",
      contracts: [
        { serviceCode: "SP_INLAND_PARCEL", contractId: "41448820", isDefault: true, isActive: true },
        { serviceCode: "BUSINESS_PARCEL", contractId: "41793509", isDefault: false, isActive: true },
      ],
    };
    expect(hideWorkspaceBookingToggle(config)).toBe(false);
    expect(parcelServiceToggleOptions(config).map((item) => item.value)).toEqual([
      "SP_INLAND_PARCEL",
      "BUSINESS_PARCEL",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { indiaPostOfficeWritePayload, indiaPostPickupOfficeWritePayload } from "@/modules/india-post/office-patch";

describe("indiaPostOfficeWritePayload", () => {
  it("saves an 8-digit office id", () => {
    expect(indiaPostOfficeWritePayload("22360042", "Manjerikla HO", "626003")).toEqual({
      pickupDropoffOfficeId: "22360042",
      pickupDropoffOfficeName: "Manjerikla HO",
      pickupDropoffOfficePincode: "626003",
    });
  });

  it("clears the office id and name when the field is empty", () => {
    expect(indiaPostOfficeWritePayload("", null, null)).toEqual({
      pickupDropoffOfficeId: null,
      pickupDropoffOfficeName: null,
      pickupDropoffOfficePincode: null,
    });
  });

  it("rejects a short office id", () => {
    expect(indiaPostOfficeWritePayload("2236")).toEqual({ error: "Office ID is 8 digits." });
  });
});

describe("indiaPostPickupOfficeWritePayload", () => {
  it("saves pickup office id and metadata", () => {
    expect(
      indiaPostPickupOfficeWritePayload({
        officeId: "21360043",
        officeName: "Mysuru H.O",
        pincode: "570001",
        officeTypeCode: "HPO",
        city: "MYSURU",
        state: "Karnataka",
      })
    ).toEqual({
      pickupOfficeId: "21360043",
      pickupOfficeName: "Mysuru H.O",
      pickupOfficePincode: "570001",
      pickupOfficeTypeCode: "HPO",
      pickupOfficeCity: "MYSURU",
      pickupOfficeState: "Karnataka",
    });
  });

  it("rejects a short pickup office id", () => {
    expect(indiaPostPickupOfficeWritePayload({ officeId: "2136" })).toEqual({
      error: "Please select a pickup office.",
    });
  });

  it("rejects an incomplete pincode", () => {
    expect(indiaPostPickupOfficeWritePayload({ officeId: "21360043", pincode: "57001" })).toEqual({
      error: "Enter a valid 6-digit pincode.",
    });
  });

  it("clears pickup office fields when empty", () => {
    expect(
      indiaPostPickupOfficeWritePayload({
        officeId: "",
        officeName: null,
        pincode: null,
        officeTypeCode: null,
        city: null,
        state: null,
      })
    ).toEqual({
      pickupOfficeId: null,
      pickupOfficeName: null,
      pickupOfficePincode: null,
      pickupOfficeTypeCode: null,
      pickupOfficeCity: null,
      pickupOfficeState: null,
    });
  });
});

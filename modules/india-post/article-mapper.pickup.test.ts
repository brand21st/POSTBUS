import { describe, expect, it } from "vitest";
import { mapExcelRowToArticle } from "@/modules/india-post/article-mapper";

function excelRow(overrides: Record<string, string> = {}) {
  return {
    barcode_no: "ET214330016IN",
    pickup_address_flag: "FALSE",
    alt_address_flag: "",
    physical_weight: "500",
    pickup_dropoff_office_id: "",
    drop_off_pincode: "682311",
    length: "20",
    breadth_diameter: "15",
    height: "10",
    shape_of_article: "",
    priority_flag: "",
    delivery_instruction: "",
    instruction_rts: "",
    sender_name: "Kerlaz",
    sender_company: "Kerlaz",
    sender_add_line_1: "Road",
    sender_add_line_2: "",
    sender_add_line_3: "",
    sender_city: "Ernakulam",
    sender_state: "Kerala",
    sender_pincode: "682311",
    sender_mobile_no: "9876543210",
    sender_emailid: "",
    receiver_name: "Customer",
    receiver_company: "Customer",
    receiver_add_line_1: "Street",
    receiver_add_line_2: "",
    receiver_add_line_3: "",
    receiver_city: "Chennai",
    receiver_state: "Tamil Nadu",
    receiver_pincode: "600001",
    receiver_mobile_no: "9944388249",
    receiver_emailid: "",
    codr_cod: "",
    value_for_codr_cod: "",
    insurance_type: "",
    value_of_insurance: "",
    ack: "",
    reg: "",
    prepayment_code: "",
    value_of_prepayment: "",
    otp: "",
    bulk_reference: "",
    ...overrides,
  };
}

describe("mapExcelRowToArticle office selection", () => {
  it("keeps the drop-off office for DROPOFF rows", () => {
    const draft = mapExcelRowToArticle({
      serial: "1",
      serviceCode: "SP_INLAND_PARCEL",
      customerId: "1788590988",
      contractId: "41793509",
      officeId: "22660454",
      pickupOfficeId: "21360043",
      originPin: "682311",
      row: excelRow(),
    });
    expect(draft.pickupOrDropoff).toBe("DROPOFF");
    expect(draft.officeId).toBe("22660454");
  });

  it("uses the saved pickup office when the Excel row is PICKUP", () => {
    const draft = mapExcelRowToArticle({
      serial: "1",
      serviceCode: "SP_INLAND_PARCEL",
      customerId: "1788590988",
      contractId: "41793509",
      officeId: "22660454",
      pickupOfficeId: "21360043",
      originPin: "682311",
      row: excelRow({ pickup_address_flag: "TRUE" }),
    });
    expect(draft.pickupOrDropoff).toBe("PICKUP");
    expect(draft.officeId).toBe("21360043");
  });

  it("does not invent an office id when the row and config are empty", () => {
    const draft = mapExcelRowToArticle({
      serial: "1",
      serviceCode: "SP_INLAND_PARCEL",
      customerId: "1788590988",
      contractId: "41793509",
      officeId: "",
      pickupOfficeId: "",
      originPin: "682311",
      row: excelRow({ pickup_address_flag: "TRUE" }),
    });
    expect(draft.officeId).toBe("");
  });
});

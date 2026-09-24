import { describe, expect, it } from "vitest";
import {
  indiaPostApiRoot,
  indiaPostBookingArticle,
  indiaPostBookingArticleType,
  indiaPostBookingUrl,
  indiaPostDomesticLabelPayload,
  indiaPostMobile,
  indiaPostSessionUrl,
  indiaPostShapeOfArticle,
  indiaPostTransmissionMode,
  indiaPostVolumetricWeightGrams,
} from "@/modules/india-post/endpoints";

describe("indiaPostApiRoot", () => {
  it("normalizes a host to /beextcustomer", () => {
    expect(indiaPostApiRoot("https://app.indiapost.gov.in")).toBe(
      "https://app.indiapost.gov.in/beextcustomer"
    );
  });

  it("keeps an explicit /beextcustomer root", () => {
    expect(indiaPostApiRoot("https://app.indiapost.gov.in/beextcustomer")).toBe(
      "https://app.indiapost.gov.in/beextcustomer"
    );
  });

  it("strips a trailing /v1 so login can add it back without booking inheriting it", () => {
    expect(indiaPostApiRoot("https://app.indiapost.gov.in/beextcustomer/v1")).toBe(
      "https://app.indiapost.gov.in/beextcustomer"
    );
    expect(indiaPostApiRoot("https://test.cept.gov.in/beextcustomer/v1/")).toBe(
      "https://test.cept.gov.in/beextcustomer"
    );
  });
});

describe("production login and booking URLs", () => {
  it("uses /v1 for production login", () => {
    expect(indiaPostSessionUrl("PRODUCTION", "/access/login")).toBe(
      "https://app.indiapost.gov.in/beextcustomer/v1/access/login"
    );
  });

  it("uses process-articles without /v1 for production booking", () => {
    const booking = indiaPostBookingUrl("PRODUCTION", "1788590988");
    expect(booking).toBe(
      "https://app.indiapost.gov.in/beextcustomer/process-articles/1788590988"
    );
    expect(booking).not.toContain("/v1/process-articles/");
  });

  it("keeps UAT booking on the documented no-/v1 route", () => {
    expect(indiaPostBookingUrl("UAT", "3000064781")).toBe(
      "https://test.cept.gov.in/beextcustomer/process-articles/3000064781"
    );
    expect(indiaPostSessionUrl("UAT", "/access/login")).toBe(
      "https://test.cept.gov.in/beextcustomer/v1/access/login"
    );
  });
});

describe("article type and shape", () => {
  it("sends SP and BP as documented for booking", () => {
    expect(indiaPostBookingArticleType("SP_INLAND_PARCEL")).toBe("SP");
    expect(indiaPostBookingArticleType("SP_INLAND_DOC")).toBe("SP");
    expect(indiaPostBookingArticleType("BUSINESS_PARCEL")).toBe("BP");
  });

  it("uses DOC for light Speed Post and NROL for parcels", () => {
    expect(indiaPostShapeOfArticle("SP_INLAND_DOC", 250)).toBe("DOC");
    expect(indiaPostShapeOfArticle("SP_INLAND_PARCEL", 1500)).toBe("NROL");
    expect(indiaPostShapeOfArticle("BUSINESS_PARCEL", 550)).toBe("NROL");
  });
});

describe("indiaPostMobile", () => {
  it("accepts a 10 digit Indian mobile", () => {
    expect(indiaPostMobile("+91 98765 43210")).toBe("9876543210");
  });

  it("rejects numbers that do not start with 6-9", () => {
    expect(indiaPostMobile("0000000000")).toBeNull();
    expect(indiaPostMobile("")).toBeNull();
  });
});

describe("indiaPost domestic label payload", () => {
  it("builds the CEPT label/create/domestic fields for Business Parcel", () => {
    const payload = indiaPostDomesticLabelPayload({
      customerId: "1788590988",
      barcode: "ET000000003IN",
      serviceCode: "BUSINESS_PARCEL",
      bookedAt: "2026-09-21T10:32:12.759Z",
      weightGrams: 500,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 4,
      tariff: "40.00",
      bkgRefId: "batch_1788590988_test",
      recipientName: "Vishnu Priya",
      recipientMobile: "9944388249",
      recipientLine1: "Sulakkarai",
      recipientCity: "Kurakkundu",
      recipientState: "Tamil Nadu",
      recipientPin: "626003",
      senderName: "Khelon Lifestyle",
      senderLine1: "NH 85",
      senderLine2: "Near SO",
      senderPin: "682311",
      deliveryOfficeName: "Virudhunagar HO",
      bookingOfficeName: "Kolenchery SO",
      bookingOfficePin: "682311",
    });
    expect(payload.channel_type).toBe("E");
    expect(payload.user_type).toBe("R");
    expect(payload.booking_type).toBe("COMMERCIAL");
    expect(payload.identifier).toBe("Domestic");
    expect(payload.size).toBe("A6");
    expect(payload.payment_mode).toBe("CO");
    expect(payload.payment_status).toBe("PC");
    expect(payload.cod_value).toBe(0);
    expect(payload.recipient_addressl1).toBe("Sulakkarai");
    expect(payload.recipient_addressl2).toBe("Ph:9944388249");
    expect(payload.recipient_addressl3).toBe("Prepaid");
    expect(payload.sender_addressl3).toBe("");
    expect(payload.service_type).toBe("BP");
    expect(payload.transmission_mode).toBe("S");
    expect(payload.volumetric_weight).toBe(480);
    expect(payload.charged_weight).toBe(500);
    expect(payload.sender_name).toBe("Khelon Lifestyle");
    expect(payload.sender_addressl1).toBe("NH 85");
    expect(payload.sender_addressl2).toBe("Near SO");
    expect(payload.booking_office_name).toBe("Kolenchery SO");
    expect(payload.booking_office_pin).toBe("682311");
  });

  it("maps COD orders onto India Post COD payment and amount", () => {
    const payload = indiaPostDomesticLabelPayload({
      customerId: "1788590988",
      barcode: "ET000000003IN",
      serviceCode: "BUSINESS_PARCEL",
      weightGrams: 500,
      lengthCm: 30,
      widthCm: 20,
      heightCm: 4,
      recipientName: "Clint Varghese",
      recipientMobile: "9876543210",
      recipientLine1: "House 12, MG Road",
      recipientLine2: "Near Metro",
      recipientCity: "Kochi",
      recipientState: "Kerala",
      recipientPin: "683565",
      senderName: "Aurimo by Nish",
      senderLine1: "NH 85",
      senderMobile: "9000000000",
      senderCity: "Ernakulam",
      senderState: "Kerala",
      senderPin: "682311",
      bookingOfficeName: "Kolenchery SO",
      bookingOfficePin: "682311",
      paymentMode: "COD",
      codAmount: "799.00",
    });
    expect(payload.payment_mode).toBe("COD");
    expect(payload.cod_value).toBe(799);
    expect(payload.recipient_addressl1).toBe("House 12, MG Road");
    expect(payload.recipient_addressl2).toBe("Near Metro");
    expect(payload.recipient_addressl3).toBe("Ph:9876543210 COD");
    expect(payload.sender_addressl2).toBe("Ph:9000000000");
  });

  it("uses Speed Post air transmission", () => {
    expect(indiaPostTransmissionMode("SP_INLAND_DOC")).toBe("A");
    expect(indiaPostVolumetricWeightGrams(10, 10, 10)).toBe(200);
  });
});

describe("indiaPostBookingArticle", () => {
  it("sends DROPOFF with origin pin, not the receiver pin", () => {
    const article = indiaPostBookingArticle({
      customerId: "1788590988",
      contractId: "41793509",
      barcode: "ET214330016IN",
      officeId: "22660454",
      originPin: "682311",
      serviceCode: "BUSINESS_PARCEL",
      weightGrams: 500,
      lengthCm: 20,
      widthCm: 15,
      heightCm: 10,
      senderName: "kerlaz",
      senderLine1: "Registered pickup",
      senderCity: "Ernakulam",
      senderState: "Kerala",
      senderMobile: "9876543210",
      receiverName: "Vishnu Priya",
      receiverLine1: "Sulakkarai",
      receiverCity: "Kurakkundu",
      receiverState: "Tamil Nadu",
      receiverPin: "626003",
      receiverMobile: "9944388249",
    });
    expect(article.pickup_or_dropoff).toBe("DROPOFF");
    expect(article.pickup_address_flag).toBe("FALSE");
    expect(article.drop_off_pincode).toBe("682311");
    expect(article.sender_pincode).toBe("682311");
    expect(article.receiver_pincode).toBe("626003");
    expect(article.article_type).toBe("BP");
    expect(article.sender_city).not.toBe("NA");
    expect(article.pickup_dropoff_office_id).toBe(22660454);
  });
});

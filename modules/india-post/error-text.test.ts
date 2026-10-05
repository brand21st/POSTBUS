import { describe, expect, it } from "vitest";
import {
  indiaPostArticleErrorText,
  indiaPostBookingHasArticleOutcomes,
  indiaPostFormatBookingFailure,
} from "@/modules/india-post/error-text";

describe("indiaPostFormatBookingFailure", () => {
  it("joins every CEPT field error instead of the first only", () => {
    expect(
      indiaPostFormatBookingFailure({
        success: false,
        message: "Request validation failed",
        errors: [
          { msg: "Articles must be an array with 1 to 100,000 items" },
          { msg: "Custom ID is required. Use either path parameter (/process-articles/:customId) or query parameter (?customId=xxx)" },
        ],
      })
    ).toBe(
      "Articles must be an array with 1 to 100,000 items; Custom ID is required. Use either path parameter (/process-articles/:customId) or query parameter (?customId=xxx); Request validation failed"
    );
  });

  it("keeps every error_articles message", () => {
    expect(
      indiaPostArticleErrorText([
        "Dropoff Officeid is required when pickup_or_dropoff is DROPOFF",
        "Sender pincode must be exactly 6 digits",
      ])
    ).toBe(
      "Dropoff Officeid is required when pickup_or_dropoff is DROPOFF; Sender pincode must be exactly 6 digits"
    );
  });

  it("detects per-article CEPT outcomes", () => {
    expect(
      indiaPostBookingHasArticleOutcomes({
        success: false,
        error_articles: [{ barcode_no: "EB468790992IN", errors: ["Dropoff pincode must be exactly 6 digits"] }],
      })
    ).toBe(true);
    expect(indiaPostBookingHasArticleOutcomes({ success: false, message: "Request validation failed" })).toBe(false);
  });
});

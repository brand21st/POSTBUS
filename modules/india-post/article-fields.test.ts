import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CEPT_BOOKING_FIELD_NAMES,
  CEPT_BOOKING_FIELDS,
  mappingTableMarkdown,
} from "@/modules/india-post/article-fields";

describe("CEPT booking field registry", () => {
  it("lists every documented process-articles field exactly once", () => {
    expect(new Set(CEPT_BOOKING_FIELD_NAMES).size).toBe(CEPT_BOOKING_FIELD_NAMES.length);
    expect(CEPT_BOOKING_FIELDS.map((field) => field.name)).toEqual(
      expect.arrayContaining([
        "bulk_customer_id",
        "contract_id",
        "barcode_no",
        "physical_weight",
        "receiver_pincode",
        "sender_pincode",
        "codr_cod",
        "otp",
        "pickup_schedule_slot",
        "alt_alternate_mobile_no",
      ])
    );
  });

  it("keeps mapping-table.md in sync with the registry", () => {
    const path = join(process.cwd(), "modules/india-post/mapping-table.md");
    const markdown = readFileSync(path, "utf8");
    for (const name of CEPT_BOOKING_FIELD_NAMES) {
      expect(markdown).toContain(`| ${name} |`);
    }
    expect(mappingTableMarkdown().split("\n").length).toBe(CEPT_BOOKING_FIELDS.length + 2);
  });

  it("assigns every documented field a source", () => {
    for (const field of CEPT_BOOKING_FIELDS) {
      expect(field.source.length).toBeGreaterThan(0);
      expect(field.transformation.length).toBeGreaterThan(0);
      expect(field.validation.length).toBeGreaterThan(0);
    }
  });

  it("does not leave otp as a live workflow", () => {
    const otp = CEPT_BOOKING_FIELDS.find((field) => field.name === "otp");
    expect(otp?.transformation).toMatch(/Always FALSE/i);
  });
});

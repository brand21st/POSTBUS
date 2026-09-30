import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseIndiaPostBookingWorkbook } from "@/modules/india-post/excel-ingest";

describe("India Post Excel ingest", () => {
  it("maps ArticleDetails by header name and joins pickup by serial", async () => {
    const bytes = readFileSync(join(process.cwd(), "bulkdomesticone_28042026.xlsx"));
    const parsed = await parseIndiaPostBookingWorkbook(bytes);
    expect(parsed.issues.filter((issue) => issue.field === "ArticleDetails")).toHaveLength(0);
    expect(parsed.articles.length).toBeGreaterThan(0);
    const first = parsed.articles[0];
    expect(first.barcode_no).toBe("RK000000510IN");
    expect(first.physical_weight).toBe("1000");
    expect(first.receiver_pincode).toBe("600052");
    expect([...parsed.pickups.keys()]).toContain("1");
    expect(parsed.pickups.get("1")).toMatchObject({ city: "Chennai", pincode: "600001" });
    expect(parsed.issues.filter((issue) => issue.field === "Information")).toHaveLength(0);
    expect(parsed.issues.filter((issue) => issue.error === "Duplicate header.")).toHaveLength(0);
  });
});

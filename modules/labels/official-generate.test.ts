import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("official India Post label generation", () => {
  it("saves the official India Post PDF without a merchant overlay", () => {
    const source = readFileSync(path.join(process.cwd(), "workers/processor.ts"), "utf8");
    expect(source).not.toContain("stampOrgLogoOnLabel");
    expect(source).toContain("kind: \"INDIA_POST\"");
    expect(source).not.toContain("overlayMerchantOnOfficialPdf");
    expect(source).not.toContain("persistMerchantPackingLabel");
    expect(readFileSync(path.join(process.cwd(), "modules/labels/official-fetch.ts"), "utf8")).toContain(
      "overlayIndiaPostPartyBox"
    );
  });
});

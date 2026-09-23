import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("official India Post label generation", () => {
  it("does not stamp a merchant logo onto new official PDFs", () => {
    const source = readFileSync(path.join(process.cwd(), "workers/processor.ts"), "utf8");
    expect(source).not.toContain("stampOrgLogoOnLabel");
    expect(source).toContain("kind: \"INDIA_POST\"");
    expect(source).toContain("persistMerchantPackingLabel");
  });
});

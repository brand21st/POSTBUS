import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { preserveOfficialIndiaPostPdf } from "@/modules/labels/official-fetch";

describe("official India Post label generation", () => {
  it("saves the official India Post PDF without any PostBus overlay", () => {
    const source = readFileSync(path.join(process.cwd(), "workers/processor.ts"), "utf8");
    const fetchSource = readFileSync(path.join(process.cwd(), "modules/labels/official-fetch.ts"), "utf8");
    expect(source).not.toContain("stampOrgLogoOnLabel");
    expect(source).toContain("kind: \"INDIA_POST\"");
    expect(source).not.toContain("overlayMerchantOnOfficialPdf");
    expect(source).not.toContain("persistMerchantPackingLabel");
    expect(fetchSource).not.toContain("overlayIndiaPostPartyBox");
    expect(fetchSource).not.toContain("officialAddressLines");
    expect(fetchSource).not.toContain("drawRectangle");
  });

  it("preserves every byte returned by CEPT", () => {
    const cept = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff]);
    const arrayBuffer = cept.buffer.slice(cept.byteOffset, cept.byteOffset + cept.byteLength) as ArrayBuffer;
    expect([...preserveOfficialIndiaPostPdf(cept)]).toEqual([...cept]);
    expect([...preserveOfficialIndiaPostPdf(arrayBuffer)]).toEqual([...cept]);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { indiaPostLabelRequestError, preserveOfficialIndiaPostPdf } from "@/modules/labels/official-fetch";

describe("official India Post label generation", () => {
  it("saves the official India Post PDF without any PostBus overlay", () => {
    const source = readFileSync(path.join(process.cwd(), "workers/processor.ts"), "utf8");
    const fetchSource = readFileSync(path.join(process.cwd(), "modules/labels/official-fetch.ts"), "utf8");
    expect(source).not.toContain("stampOrgLogoOnLabel");
    expect(source).toContain("findReadyIndiaPostLabel");
    expect(source).toContain("fetchOfficialIndiaPostLabelPdf");
    expect(source).not.toContain("overlayMerchantOnOfficialPdf");
    expect(source).not.toContain("persistMerchantPackingLabel");
    expect(fetchSource).not.toContain("overlayIndiaPostPartyBox");
    expect(fetchSource).not.toContain("officialAddressLines");
    expect(fetchSource).not.toContain("drawRectangle");
    expect(source).not.toContain("india-post-barcode-image");
    expect(source).not.toContain("packing-pdf");
    expect(fetchSource).not.toContain("india-post-barcode-image");
    expect(fetchSource).not.toContain("packing-pdf");
  });

  it("preserves every byte returned by CEPT", () => {
    const cept = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00, 0xff]);
    const arrayBuffer = cept.buffer.slice(cept.byteOffset, cept.byteOffset + cept.byteLength) as ArrayBuffer;
    expect([...preserveOfficialIndiaPostPdf(cept)]).toEqual([...cept]);
    expect([...preserveOfficialIndiaPostPdf(arrayBuffer)]).toEqual([...cept]);
  });

  it("maps India Post label API failures to AppError", () => {
    const validation = indiaPostLabelRequestError(
      Object.assign(new Error("Receiver name, address and 6-digit pincode are required for the India Post label."), {
        code: "VALIDATION_ERROR",
      })
    );
    expect(validation).toBeInstanceOf(AppError);
    expect(validation.code).toBe(ERROR_CODES.VALIDATION_ERROR);
    const provider = indiaPostLabelRequestError(new Error("India Post label generation failed."));
    expect(provider.code).toBe(ERROR_CODES.PROVIDER_ERROR);
  });

  it("Label latest generates through CEPT and does not serve a stored PDF", () => {
    const commerce = readFileSync(path.join(process.cwd(), "lib/api/v1/commerce.ts"), "utf8");
    expect(commerce).toContain("generateAndStoreOfficialIndiaPostLabelPdf");
    expect(commerce).toContain('X-Label-Source", "india-post"');
    expect(commerce).not.toContain('X-Label-Source", "stored"');
    const fetchSource = readFileSync(path.join(process.cwd(), "modules/labels/official-fetch.ts"), "utf8");
    expect(fetchSource).toContain("indiaPostDomesticLabelPayload");
    expect(fetchSource).toContain("persistLabelPdf");
    expect(fetchSource).toContain("generateLabel");
  });
});

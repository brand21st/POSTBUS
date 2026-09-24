import { overlayMerchantOnOfficialPdf, type PackingLabelData } from "@/modules/labels/packing-pdf";

export async function composeFinalLabelPdf(
  officialPdf: Uint8Array | Buffer,
  template: unknown,
  data: PackingLabelData
) {
  return overlayMerchantOnOfficialPdf(officialPdf, template, data);
}

import bwipjs from "bwip-js";
import { normalizeIndiaPostArticleId } from "@/modules/india-post/barcode";

export function articleIdFromShipment(row?: { tracking_number?: unknown; barcode?: unknown } | null) {
  const tracking = normalizeIndiaPostArticleId(row?.tracking_number);
  if (tracking) return tracking;
  return normalizeIndiaPostArticleId(row?.barcode);
}

export async function indiaPostBarcodePng(articleId: string): Promise<Buffer | null> {
  const article = normalizeIndiaPostArticleId(articleId);
  if (!article) return null;
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: article,
    scale: 3,
    height: 12,
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
  });
  return Buffer.from(png);
}

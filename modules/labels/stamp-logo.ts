import { PDFDocument } from "pdf-lib";

function mimeFromPath(path: string | null | undefined) {
  const ext = path?.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "";
}

export async function stampOrgLogoOnLabel(
  pdfBytes: ArrayBuffer | Uint8Array,
  logoBytes: ArrayBuffer | Uint8Array,
  mimeOrPath?: string | null
) {
  const mime = (mimeOrPath ?? "").toLowerCase();
  const kind = mime.includes("png")
    ? "png"
    : mime.includes("jpeg") || mime.includes("jpg")
      ? "jpg"
      : mimeFromPath(mimeOrPath) === "image/png"
        ? "png"
        : mimeFromPath(mimeOrPath) === "image/jpeg"
          ? "jpg"
          : null;
  if (!kind) return pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  const document = await PDFDocument.load(pdfBytes);
  const page = document.getPages()[0];
  if (!page) return pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);

  const image =
    kind === "png"
      ? await document.embedPng(logoBytes)
      : await document.embedJpg(logoBytes);
  const { width, height } = page.getSize();
  const max = Math.min(width, height) * 0.16;
  const scale = Math.min(max / image.width, max / image.height, 1);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  page.drawImage(image, {
    x: 12,
    y: 12,
    width: drawWidth,
    height: drawHeight,
  });
  return document.save();
}

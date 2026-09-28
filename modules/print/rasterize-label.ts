import { labelRasterPlan, type LabelRasterPlan } from "@/modules/print/raster-plan";

export async function rasterizeLabelPdf(bytes: Uint8Array, maxWidthMm: number, dpi: number) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const plan = labelRasterPlan({
    widthPt: base.width,
    heightPt: base.height,
    maxWidthMm,
    dpi,
  });
  const viewport = page.getViewport({ scale: plan.scaleX });
  if (Math.abs(plan.scaleX - plan.scaleY) > 1e-9) {
    throw new Error("The label could not be prepared without resizing.");
  }
  if (Math.abs(viewport.width - plan.widthPx) > 1 || Math.abs(viewport.height - plan.heightPx) > 1) {
    throw new Error("The label could not be prepared without resizing.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("The label could not be prepared without resizing.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { plan: plan satisfies LabelRasterPlan, rgba: image.data, widthPx: canvas.width, heightPx: canvas.height };
}

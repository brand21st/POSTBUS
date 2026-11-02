import { PDFDocument } from "pdf-lib";

const PRINT_CLEANUP_MS = 60_000;

export type PrintHost = {
  createElement: Document["createElement"];
  body: { appendChild: (node: Node) => Node };
};

export type PdfPageSizePt = { width: number; height: number };

function roundPt(value: number) {
  return Math.round(value * 100) / 100;
}

export function printPageCss(widthPt: number, heightPt: number) {
  return `@page { size: ${roundPt(widthPt)}pt ${roundPt(heightPt)}pt; margin: 0; }`;
}

export function printPdfDocumentHtml(href: string, widthPt: number, heightPt: number) {
  const width = `${roundPt(widthPt)}pt`;
  const height = `${roundPt(heightPt)}pt`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${printPageCss(widthPt, heightPt)}
html, body { margin: 0; width: ${width}; height: ${height}; }
embed { display: block; width: ${width}; height: ${height}; border: 0; }
</style></head><body><embed src="${href}" type="application/pdf"></body></html>`;
}

export async function pdfPageSizePt(blob: Blob): Promise<PdfPageSizePt | null> {
  try {
    const document = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false });
    const page = document.getPages()[0];
    if (!page) return null;
    const size = page.getSize();
    if (!(size.width > 0) || !(size.height > 0)) return null;
    return size;
  } catch {
    return null;
  }
}

export async function printPdfBlob(blob: Blob, documentRef: PrintHost = document) {
  const href = URL.createObjectURL(blob);
  const frame = documentRef.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  const cleanup = () => {
    frame.remove();
    URL.revokeObjectURL(href);
  };
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      cleanup();
      return;
    }
    win.focus();
    win.print();
    setTimeout(cleanup, PRINT_CLEANUP_MS);
  };
  const page = await pdfPageSizePt(blob);
  if (page) {
    frame.srcdoc = printPdfDocumentHtml(href, page.width, page.height);
  } else {
    frame.src = href;
  }
  documentRef.body.appendChild(frame);
  return { href, frame, page };
}

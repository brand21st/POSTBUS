import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { printPageCss, printPdfBlob, printPdfDocumentHtml, type PrintHost } from "@/lib/print/browser-pdf";

function printHost() {
  const print = vi.fn();
  const focus = vi.fn();
  const style: Record<string, string> = {};
  const frame = {
    setAttribute: vi.fn(),
    style,
    contentWindow: { focus, print },
    src: "",
    srcdoc: "",
    onload: null as null | (() => void),
    remove: vi.fn(),
  };
  const host: PrintHost = {
    createElement: () => frame as unknown as HTMLIFrameElement,
    body: { appendChild: vi.fn((node) => node) },
  };
  return { frame, host, print, focus };
}

describe("printPdfBlob", () => {
  it("falls back to printing the PDF blob when the page size cannot be read", async () => {
    const { frame, host, print, focus } = printHost();
    const { href, page } = await printPdfBlob(new Blob(["%PDF-1.4"], { type: "application/pdf" }), host);
    expect(href.startsWith("blob:")).toBe(true);
    expect(page).toBeNull();
    expect(frame.src).toBe(href);
    expect(frame.srcdoc).toBe("");
    expect(frame.setAttribute).toHaveBeenCalledWith("aria-hidden", "true");
    expect(host.body.appendChild).toHaveBeenCalled();
    frame.onload?.();
    expect(focus).toHaveBeenCalled();
    expect(print).toHaveBeenCalled();
  });

  it("prints with @page matching the PDF MediaBox", async () => {
    const { frame, host } = printHost();
    const document = await PDFDocument.create();
    document.addPage([288.5, 430.87]);
    const blob = new Blob([await document.save()], { type: "application/pdf" });
    const { href, page } = await printPdfBlob(blob, host);
    expect(page?.width).toBeCloseTo(288.5, 1);
    expect(page?.height).toBeCloseTo(430.87, 1);
    expect(frame.src).toBe("");
    expect(frame.srcdoc).toContain(printPageCss(page!.width, page!.height));
    expect(frame.srcdoc).toContain(`src="${href}"`);
    expect(printPdfDocumentHtml(href, page!.width, page!.height)).toContain("margin: 0");
  });
});

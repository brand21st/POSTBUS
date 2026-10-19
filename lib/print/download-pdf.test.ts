import { describe, expect, it, vi } from "vitest";
import { downloadPdfFile, PDF_DOWNLOAD_REVOKE_MS, pdfDownloadBlob, pdfDownloadFilename } from "@/lib/print/download-pdf";

function downloadHost() {
  const link = {
    href: "",
    download: "",
    rel: "",
    click: vi.fn(),
  };
  const created: Blob[] = [];
  const host = {
    createElement: vi.fn(() => link),
    append: vi.fn(),
    remove: vi.fn(),
    createObjectURL: vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:download-pdf";
    }),
    revokeObjectURL: vi.fn(),
    setTimeout: vi.fn((fn: () => void, ms: number) => {
      expect(ms).toBe(PDF_DOWNLOAD_REVOKE_MS);
      fn();
      return 0;
    }),
  };
  return { created, host, link };
}

describe("downloadPdfFile", () => {
  it("keeps a .pdf filename", () => {
    expect(pdfDownloadFilename("shipping-labels.pdf")).toBe("shipping-labels.pdf");
    expect(pdfDownloadFilename("  labels  ")).toBe("labels.pdf");
  });

  it("wraps the PDF as octet-stream so the browser saves instead of opening it", () => {
    const wrapped = pdfDownloadBlob(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    expect(wrapped.type).toBe("application/octet-stream");
  });

  it("clicks a download link and does not open a window", () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    const { created, host, link } = downloadHost();
    const source = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const result = downloadPdfFile(source, "shipping-labels.pdf", host);

    expect(result.filename).toBe("shipping-labels.pdf");
    expect(result.href).toBe("blob:download-pdf");
    expect(created[0]?.type).toBe("application/octet-stream");
    expect(link.download).toBe("shipping-labels.pdf");
    expect(link.href).toBe("blob:download-pdf");
    expect(link.rel).toBe("noopener");
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(host.append).toHaveBeenCalledWith(link);
    expect(host.remove).toHaveBeenCalledWith(link);
    expect(host.revokeObjectURL).toHaveBeenCalledWith("blob:download-pdf");
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

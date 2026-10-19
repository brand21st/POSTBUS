export const PDF_DOWNLOAD_REVOKE_MS = 60_000;

export type DownloadAnchor = {
  href: string;
  download: string;
  rel: string;
  click: () => void;
};

export type DownloadPdfHost = {
  createElement: (tag: "a") => DownloadAnchor;
  append: (node: DownloadAnchor) => void;
  remove: (node: DownloadAnchor) => void;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (href: string) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
};

function defaultHost(): DownloadPdfHost {
  return {
    createElement: () => document.createElement("a"),
    append: (node) => {
      document.body.appendChild(node as HTMLAnchorElement);
    },
    remove: (node) => {
      (node as HTMLAnchorElement).remove();
    },
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (href) => URL.revokeObjectURL(href),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  };
}

export function pdfDownloadFilename(name: string) {
  const trimmed = name.trim() || "download.pdf";
  return /\.pdf$/i.test(trimmed) ? trimmed : `${trimmed}.pdf`;
}

export function pdfDownloadBlob(source: Blob) {
  return new Blob([source], { type: "application/octet-stream" });
}

export function downloadPdfFile(source: Blob, filename: string, host: DownloadPdfHost = defaultHost()) {
  const file = pdfDownloadFilename(filename);
  const blob = pdfDownloadBlob(source);
  const href = host.createObjectURL(blob);
  const link = host.createElement("a");
  link.href = href;
  link.download = file;
  link.rel = "noopener";
  host.append(link);
  link.click();
  host.remove(link);
  host.setTimeout(() => host.revokeObjectURL(href), PDF_DOWNLOAD_REVOKE_MS);
  return { href, blob, filename: file };
}

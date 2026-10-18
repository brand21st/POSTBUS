const PRINT_CLEANUP_MS = 60_000;

export type PrintHost = {
  createElement: Document["createElement"];
  body: { appendChild: (node: Node) => Node };
};

export function printPdfBlob(blob: Blob, documentRef: PrintHost = document) {
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
  frame.src = href;
  documentRef.body.appendChild(frame);
  return { href, frame };
}

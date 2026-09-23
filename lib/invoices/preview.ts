export async function fetchInvoicePdfBlob(invoiceId: string) {
  const response = await fetch(`/api/v1/invoices/${invoiceId}/download`, { credentials: "same-origin" });
  const type = response.headers.get("Content-Type") ?? "";
  if (!response.ok || !type.includes("application/pdf")) {
    let message = "Could not open the invoice.";
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message || message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }
  return response.blob();
}

export async function openInvoicePdf(invoiceId: string) {
  await fetchInvoicePdfBlob(invoiceId);
  window.open(`/api/v1/invoices/${invoiceId}/download`, "_blank", "noopener,noreferrer");
}

export async function downloadInvoicePdf(invoiceId: string, filename: string) {
  const blob = await fetchInvoicePdfBlob(invoiceId);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export async function printInvoicePdf(invoiceId: string) {
  const blob = await fetchInvoicePdfBlob(invoiceId);
  const href = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = href;
  const cleanup = () => {
    frame.remove();
    URL.revokeObjectURL(href);
  };
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } finally {
      window.setTimeout(cleanup, 60_000);
    }
  };
  document.body.appendChild(frame);
}

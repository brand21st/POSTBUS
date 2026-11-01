export async function fetchInvoicePdfBlob(invoiceId: string, kind: "shipping" | "sales" = "shipping") {
  const path = kind === "sales" ? `/api/v1/sales-invoices/${invoiceId}/download` : `/api/v1/invoices/${invoiceId}/download`;
  const response = await fetch(path, { credentials: "same-origin" });
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

export async function openInvoicePdf(invoiceId: string, kind: "shipping" | "sales" = "shipping") {
  await fetchInvoicePdfBlob(invoiceId, kind);
  const path = kind === "sales" ? `/api/v1/sales-invoices/${invoiceId}/download` : `/api/v1/invoices/${invoiceId}/download`;
  window.open(path, "_blank", "noopener,noreferrer");
}

export async function downloadInvoicePdf(invoiceId: string, filename: string, kind: "shipping" | "sales" = "shipping") {
  const blob = await fetchInvoicePdfBlob(invoiceId, kind);
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export async function printInvoicePdf(invoiceId: string, kind: "shipping" | "sales" = "shipping") {
  const blob = await fetchInvoicePdfBlob(invoiceId, kind);
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

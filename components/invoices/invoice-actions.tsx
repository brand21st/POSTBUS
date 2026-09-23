"use client";

import { Download, Eye, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadInvoicePdf, openInvoicePdf, printInvoicePdf } from "@/lib/invoices/preview";
import type { InvoiceSummary } from "@/types/api";

export function InvoiceActions({
  invoice,
  onRetry,
  onRegenerate,
  retrying,
  compact,
}: {
  invoice?: InvoiceSummary | null;
  onRetry?: () => void;
  onRegenerate?: () => void;
  retrying?: boolean;
  compact?: boolean;
}) {
  if (!invoice) return <p className="text-sm text-muted">Invoice will appear after booking succeeds.</p>;
  const status = (invoice.status ?? "").toUpperCase();
  const number = invoice.invoiceNumber ?? invoice.invoice_number ?? "";

  if (status === "PENDING") {
    return <p className="text-sm text-muted">⏳ Generating{number ? ` ${number}` : ""}…</p>;
  }

  if (status === "FAILED") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-error">⚠ Invoice generation failed</p>
        {onRetry ? (
          <Button type="button" size="sm" variant="secondary" disabled={retrying} onClick={onRetry}>
            <RotateCcw className="size-4" />
            Retry Invoice
          </Button>
        ) : null}
      </div>
    );
  }

  const filename = `${number || invoice.id}.pdf`;
  const size = compact ? "sm" : "default";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size={size}
        variant="secondary"
        onClick={() => openInvoicePdf(invoice.id).catch((error: Error) => toast.error(error.message))}
      >
        <Eye className="size-4" />
        View
      </Button>
      <Button
        type="button"
        size={size}
        variant="secondary"
        onClick={() => downloadInvoicePdf(invoice.id, filename).catch((error: Error) => toast.error(error.message))}
      >
        <Download className="size-4" />
        Download PDF
      </Button>
      <Button
        type="button"
        size={size}
        variant="secondary"
        onClick={() => printInvoicePdf(invoice.id).catch((error: Error) => toast.error(error.message))}
      >
        <Printer className="size-4" />
        Print
      </Button>
      {onRegenerate ? (
        <Button type="button" size={size} variant="secondary" onClick={onRegenerate}>
          <RotateCcw className="size-4" />
          Regenerate
        </Button>
      ) : null}
    </div>
  );
}

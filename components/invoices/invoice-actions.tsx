"use client";

import type { ReactNode } from "react";
import { Download, Eye, Printer, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadInvoicePdf, openInvoicePdf, printInvoicePdf } from "@/lib/invoices/preview";
import { cn } from "@/lib/utils";
import type { InvoiceSummary } from "@/types/api";

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="grid size-8 place-items-center text-muted transition-colors hover:bg-surface-soft hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

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
    return <p className="text-xs text-muted">Generating{number ? ` ${number}` : ""}…</p>;
  }

  if (status === "FAILED") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-error">Generation failed</p>
        {onRetry ? (
          <Button type="button" size="sm" variant="secondary" disabled={retrying} onClick={onRetry}>
            <RotateCcw className="size-3.5" />
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  const filename = `${number || invoice.id}.pdf`;

  if (compact) {
    return (
      <div
        className="inline-flex divide-x divide-border overflow-hidden rounded-lg border border-border bg-card"
        onClick={(event) => event.stopPropagation()}
      >
        <IconAction label="View invoice" onClick={() => openInvoicePdf(invoice.id).catch((error: Error) => toast.error(error.message))}>
          <Eye className="size-3.5" />
        </IconAction>
        <IconAction
          label="Download PDF"
          onClick={() => downloadInvoicePdf(invoice.id, filename).catch((error: Error) => toast.error(error.message))}
        >
          <Download className="size-3.5" />
        </IconAction>
        <IconAction label="Print invoice" onClick={() => printInvoicePdf(invoice.id).catch((error: Error) => toast.error(error.message))}>
          <Printer className="size-3.5" />
        </IconAction>
        {onRegenerate ? (
          <IconAction label="Regenerate invoice" onClick={onRegenerate}>
            <RotateCcw className="size-3.5" />
          </IconAction>
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2")}>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => openInvoicePdf(invoice.id).catch((error: Error) => toast.error(error.message))}
      >
        <Eye className="size-4" />
        View
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => downloadInvoicePdf(invoice.id, filename).catch((error: Error) => toast.error(error.message))}
      >
        <Download className="size-4" />
        Download
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => printInvoicePdf(invoice.id).catch((error: Error) => toast.error(error.message))}
      >
        <Printer className="size-4" />
        Print
      </Button>
      {onRegenerate ? (
        <Button type="button" size="sm" variant="secondary" onClick={onRegenerate}>
          <RotateCcw className="size-4" />
          Regenerate
        </Button>
      ) : null}
    </div>
  );
}

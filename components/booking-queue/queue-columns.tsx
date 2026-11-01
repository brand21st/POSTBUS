"use client";

import Link from "next/link";
import { Info } from "lucide-react";
import type { DataTableColumn } from "@/components/dashboard/data-table";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  QUEUE_SOURCE_LABELS,
  queueStateLabel,
  queueStateVariant,
  shortId,
} from "@/components/booking-queue/view";
import { formatDate } from "@/lib/format";
import type { BookingHistoryRow, QueueListItem } from "@/modules/booking-queue/service";
import { indiaPostServiceLabel } from "@/types/domain";

type QueueRow = QueueListItem & Record<string, unknown>;
type HistoryRow = BookingHistoryRow & Record<string, unknown>;

function SourceCell({ source }: { source: string }) {
  // StatusBadge shows the channel logos the Orders page uses; Excel and Manual stay text.
  if (source === "SHOPIFY" || source === "WOOCOMMERCE" || source === "WHATSAPP") return <StatusBadge value={source} />;
  return <Badge variant="outline">{QUEUE_SOURCE_LABELS[source] ?? source}</Badge>;
}

function OrderCell({ orderId, orderNumber }: { orderId: string | null; orderNumber: string | null }) {
  if (!orderId) return <span className="text-muted">—</span>;
  return (
    <Link
      href={`/dashboard/orders/${orderId}`}
      className="font-medium text-ink hover:text-brand hover:underline"
      onClick={(event) => event.stopPropagation()}
    >
      {orderNumber || shortId(orderId)}
    </Link>
  );
}

export function queueColumns(onDetails: (row: QueueListItem) => void): DataTableColumn<QueueRow>[] {
  return [
    { id: "order", header: "Order", cell: (row) => <OrderCell orderId={row.orderId} orderNumber={row.orderNumber} />, minWidth: 96 },
    { id: "source", header: "Source", cell: (row) => <SourceCell source={row.source} />, minWidth: 96 },
    { id: "customer", header: "Customer", cell: (row) => row.customerName || "—", fill: true, minWidth: 140 },
    { id: "phone", header: "Phone", cell: (row) => row.phone || "—", minWidth: 110 },
    { id: "pincode", header: "PIN", cell: (row) => row.pincode || "—", minWidth: 72 },
    { id: "payment", header: "Payment", cell: (row) => <StatusBadge value={row.paymentStatus} />, minWidth: 90 },
    { id: "service", header: "Article type", cell: (row) => indiaPostServiceLabel(row.serviceCode), minWidth: 120 },
    {
      id: "barcode",
      header: "Barcode / AWB",
      cell: (row) => <span className="font-mono text-xs">{row.barcode || "—"}</span>,
      minWidth: 130,
    },
    { id: "batch", header: "Batch", cell: (row) => <span className="font-mono text-xs">{shortId(row.runId)}</span>, minWidth: 84 },
    { id: "mode", header: "Mode", cell: (row) => (row.enrolledVia === "AUTO" ? "Automatic" : "Manual"), minWidth: 84 },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="min-w-0">
          <Badge variant={queueStateVariant(row.state)}>{queueStateLabel(row.state)}</Badge>
          {row.lastError && row.state !== "BOOKED" ? (
            <p className="mt-1 line-clamp-1 max-w-56 text-[11px] text-muted" title={row.lastError}>
              {row.lastError}
            </p>
          ) : null}
        </div>
      ),
      minWidth: 150,
    },
    { id: "created", header: "Added", cell: (row) => formatDate(row.createdAt, true), minWidth: 120 },
    { id: "updated", header: "Last updated", cell: (row) => formatDate(row.updatedAt, true), minWidth: 120 },
    {
      id: "actions",
      header: "",
      hug: true,
      width: 48,
      cell: (row) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Details for ${row.orderNumber ?? "order"}`}
          onClick={(event) => {
            event.stopPropagation();
            onDetails(row);
          }}
        >
          <Info className="size-4" />
        </Button>
      ),
    },
  ];
}

export function historyColumns(): DataTableColumn<HistoryRow>[] {
  return [
    { id: "order", header: "Order", cell: (row) => <OrderCell orderId={row.orderId} orderNumber={row.orderNumber} />, minWidth: 96 },
    { id: "source", header: "Source", cell: (row) => <SourceCell source={row.source} />, minWidth: 96 },
    { id: "customer", header: "Customer", cell: (row) => row.customerName || "—", fill: true, minWidth: 140 },
    { id: "phone", header: "Phone", cell: (row) => row.phone || "—", minWidth: 110 },
    { id: "pincode", header: "PIN", cell: (row) => row.pincode || "—", minWidth: 72 },
    { id: "service", header: "Article type", cell: (row) => indiaPostServiceLabel(row.serviceCode), minWidth: 120 },
    {
      id: "barcode",
      header: "Barcode / AWB",
      cell: (row) => <span className="font-mono text-xs">{row.barcode || "—"}</span>,
      minWidth: 130,
    },
    {
      id: "via",
      header: "Booked from",
      cell: (row) => (row.bookedVia === "QUEUE" ? `Bulk Booking · ${shortId(row.runId)}` : "Orders page"),
      minWidth: 140,
    },
    { id: "status", header: "Shipment", cell: (row) => <StatusBadge value={row.shipmentStatus} />, minWidth: 110 },
    { id: "booked", header: "Booked at", cell: (row) => formatDate(row.bookedAt, true), minWidth: 130 },
  ];
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { addressLine, customerName, lineItems, orderNumber } from "@/lib/dashboard/records";
import { formatCurrency, formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import type { OrderRecord, ShipmentRecord } from "@/types/api";

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const order = useQuery({
    queryKey: ["order", params.id],
    queryFn: () => api<OrderRecord>(`/api/v1/orders/${params.id}`),
    enabled: Boolean(params.id),
  });

  const shipments = useQuery({
    queryKey: ["shipments", { orderId: params.id }],
    queryFn: () =>
      api<{ items?: ShipmentRecord[] }>(`/api/v1/shipments?orderId=${params.id}`),
    enabled: Boolean(params.id),
  });

  const ship = useMutation({
    mutationFn: () =>
      api("/api/v1/shipments", {
        method: "POST",
        body: JSON.stringify({ orderIds: [params.id] }),
      }),
    onSuccess: () => {
      toast.success("Shipment queued.");
      queryClient.invalidateQueries({ queryKey: ["order", params.id] });
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (order.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (order.isError || !order.data) {
    return (
      <EmptyState
        icon={Truck}
        title="Order not found"
        description={order.error instanceof Error ? order.error.message : "This order is unavailable."}
        action={
          <Link href="/dashboard/orders">
            <Button variant="secondary">Back to orders</Button>
          </Link>
        }
      />
    );
  }

  const record = order.data;
  const items = lineItems(record);
  const related = shipments.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={orderNumber(record)}
        description={`Created ${formatDate(record.createdAt ?? record.created_at, true)}`}
        actions={
          <Button type="button" onClick={() => ship.mutate()} disabled={ship.isPending}>
            <Truck className="size-4" />
            Ship order
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Order" value={<StatusBadge value={record.status} />} />
            <Row label="Payment" value={<StatusBadge value={record.paymentStatus ?? record.payment_status} />} />
            <Row
              label="Fulfillment"
              value={<StatusBadge value={record.fulfillmentStatus ?? record.fulfillment_status} />}
            />
            <Row label="Source" value={<StatusBadge value={record.source} />} />
            <Row
              label="Total"
              value={formatCurrency(record.totalAmount ?? record.total_amount, record.currency)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium text-ink">{customerName(record)}</p>
            <p className="text-muted">{record.customer?.phone ?? "—"}</p>
            <p className="text-muted">{record.customer?.email ?? "—"}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Shipping address</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            {addressLine(record.shippingAddress)}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line items</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-sm text-muted">No line items on this order.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-muted">
                    <th className="pb-3">Item</th>
                    <th className="pb-3">SKU</th>
                    <th className="pb-3">Qty</th>
                    <th className="pb-3">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id ?? index} className="border-t border-border">
                      <td className="py-3 font-medium">{item.title}</td>
                      <td className="py-3 text-muted">{item.sku || "—"}</td>
                      <td className="py-3">{item.quantity}</td>
                      <td className="py-3">
                        {formatCurrency(item.unitPrice ?? item.unit_price, record.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invoice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {record.invoice ? <StatusBadge value={record.invoice.status} /> : null}
          <InvoiceActions
            invoice={record.invoice}
            onRetry={() =>
              record.invoice &&
              api(`/api/v1/invoices/${record.invoice.id}/retry`, { method: "POST" }).then(() => {
                toast.success("Invoice retry queued.");
                queryClient.invalidateQueries({ queryKey: ["order", params.id] });
              }).catch((error: Error) => toast.error(error.message))
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shipments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {related.length === 0 ? (
            <p className="text-sm text-muted">No shipments have been created for this order.</p>
          ) : (
            related.map((shipment) => (
              <Link
                key={shipment.id}
                href={`/dashboard/shipments/${shipment.id}`}
                className="flex items-center justify-between rounded-xl border border-border px-4 py-3 hover:bg-surface-soft"
              >
                <span className="font-medium">
                  {shipment.trackingNumber ?? shipment.tracking_number ?? shipment.barcode ?? shipment.id}
                </span>
                <StatusBadge value={shipment.status} />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

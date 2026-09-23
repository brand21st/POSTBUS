"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrency, formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import type { ShipmentRecord, TrackingEvent } from "@/types/api";

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const shipment = useQuery({
    queryKey: ["shipment", params.id],
    queryFn: () => api<ShipmentRecord & { events?: TrackingEvent[] }>(`/api/v1/shipments/${params.id}`),
    enabled: Boolean(params.id),
  });

  const retry = useMutation({
    mutationFn: () => api(`/api/v1/shipments/${params.id}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Retry queued.");
      queryClient.invalidateQueries({ queryKey: ["shipment", params.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (shipment.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (shipment.isError || !shipment.data) {
    return (
      <EmptyState
        icon={Truck}
        title="Shipment not found"
        description={shipment.error instanceof Error ? shipment.error.message : "This shipment is unavailable."}
        action={
          <Link href="/dashboard/shipments">
            <Button variant="secondary">Back to shipments</Button>
          </Link>
        }
      />
    );
  }

  const record = shipment.data;
  const events = record.events ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={record.trackingNumber ?? record.tracking_number ?? record.barcode ?? "Shipment"}
        description={`Created ${formatDate(record.createdAt ?? record.created_at, true)}`}
        actions={
          <Button type="button" variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            <RotateCcw className="size-4" />
            Retry
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusBadge value={record.status} />
            {record.lastError || record.last_error ? (
              <p className="text-error">{record.lastError ?? record.last_error}</p>
            ) : (
              <p className="text-muted">No provider error recorded.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Booking</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>Service: {record.serviceCode ?? record.service_code ?? "—"}</p>
            <p>Payment: {record.paymentMode ?? record.payment_mode ?? "—"}</p>
            <p>Weight: {record.weightGrams ?? record.weight_grams ?? "—"} g</p>
            <p>Tariff: {formatCurrency(record.tariffAmount ?? record.tariff_amount)}</p>
            <p>Booked: {formatDate(record.bookedAt ?? record.booked_at, true)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>References</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>Barcode: {record.barcode ?? "—"}</p>
            <p>Tracking: {record.trackingNumber ?? record.tracking_number ?? "—"}</p>
            {record.orderId || record.order_id ? (
              <Link
                href={`/dashboard/orders/${record.orderId ?? record.order_id}`}
                className="text-brand hover:underline"
              >
                View order {record.orderNumber ?? record.order_number ?? ""}
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

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
                queryClient.invalidateQueries({ queryKey: ["shipment", params.id] });
              }).catch((error: Error) => toast.error(error.message))
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tracking events</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-muted">
              No provider events yet. Tracking only appears after India Post reports a scan.
            </p>
          ) : (
            <ol className="space-y-4">
              {events.map((event, index) => (
                <li key={event.id ?? index} className="border-l border-border pl-4">
                  <p className="text-sm font-medium text-ink">
                    {event.eventDescription ?? event.event_description ?? event.eventCode ?? event.event_code}
                  </p>
                  <p className="text-xs text-muted">
                    {[event.officeName ?? event.office_name, formatDate(event.occurredAt ?? event.occurred_at, true)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

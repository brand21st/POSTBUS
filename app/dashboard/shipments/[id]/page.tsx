"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, RotateCcw, Truck } from "lucide-react";
import { toast } from "sonner";
import { PlanLock } from "@/components/billing/plan-lock";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { IndiaPostRouting } from "@/components/dashboard/india-post-routing";
import { buildIndiaPostRoutingView } from "@/lib/dashboard/india-post-routing";
import { formatCurrency, formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { useMe } from "@/lib/hooks/use-me";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { hasPermission } from "@/lib/permissions/rbac";
import { indiaPostDisplayShipmentStatus } from "@/modules/india-post/booking-status";
import { FEATURE } from "@/modules/billing/entitlements";
import { indiaPostServiceLabel, type MemberRole } from "@/types/domain";
import type { ShipmentRecord, TrackingEvent } from "@/types/api";

export default function ShipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const me = useMe();
  const entitlements = usePlanEntitlements();
  const invoicesLocked = !entitlements.loading && !entitlements.allows(FEATURE.invoices);
  const canSync = hasPermission((me.data?.role ?? "VIEWER") as MemberRole, "shipments.write");
  const autoSynced = useRef<string | null>(null);

  const shipment = useQuery({
    queryKey: ["shipment", params.id],
    queryFn: () => api<ShipmentRecord & { events?: TrackingEvent[] }>(`/api/v1/shipments/${params.id}`),
    enabled: Boolean(params.id),
  });

  const sync = useMutation({
    mutationFn: () => api(`/api/v1/ndr-rto/${params.id}/sync`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Tracking refreshed.");
      queryClient.invalidateQueries({ queryKey: ["shipment", params.id] });
      queryClient.invalidateQueries({ queryKey: ["ndr-rto"] });
      queryClient.invalidateQueries({ queryKey: ["ndr-rto-summary"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const retry = useMutation({
    mutationFn: () => api(`/api/v1/shipments/${params.id}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Retry queued.");
      queryClient.invalidateQueries({ queryKey: ["shipment", params.id] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const openCustomLabel = async (shipmentId: string, mode: "preview" | "download" | "print") => {
    if (mode === "print") {
      try {
        const printed = await api<{ connected?: boolean; downloadPath?: string; message?: string }>(
          "/api/v1/label-template/custom-print",
          { method: "POST", body: JSON.stringify({ shipmentId }) }
        );
        if (!printed.connected && printed.downloadPath) {
          window.open(printed.downloadPath, "_blank", "noopener,noreferrer");
        }
        toast.success(printed.message || "Shipping label sent to the printer.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not print the shipping label.");
      }
      return;
    }
    const response = await fetch(`/api/v1/label-template/custom-${mode}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipmentId }),
    });
    if (!response.ok || !(response.headers.get("Content-Type") ?? "").includes("application/pdf")) {
      let message = "Could not open the shipping label.";
      try {
        const payload = (await response.json()) as { message?: string };
        message = payload.message || message;
      } catch {
        // keep default
      }
      toast.error(message);
      return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    if (mode === "download") {
      const link = document.createElement("a");
      link.href = href;
      link.download = `shipping-label-${shipmentId}.pdf`;
      link.click();
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const recordForHash = shipment.data;
  useEffect(() => {
    if (!recordForHash) return;
    const id = window.location.hash.replace("#", "");
    if (!id) return;
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [recordForHash]);

  useEffect(() => {
    if (!canSync || !params.id || shipment.isLoading || !shipment.data) return;
    const article = shipment.data.trackingNumber ?? shipment.data.tracking_number ?? shipment.data.barcode;
    const events = shipment.data.events ?? [];
    if (!article || events.length > 0) return;
    if (autoSynced.current === params.id) return;
    autoSynced.current = params.id;
    sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync once per shipment when no scans exist
  }, [canSync, params.id, shipment.data, shipment.isLoading]);

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
  const events = [...(record.events ?? [])].sort((left, right) => {
    const a = Date.parse(left.occurredAt ?? left.occurred_at ?? "") || 0;
    const b = Date.parse(right.occurredAt ?? right.occurred_at ?? "") || 0;
    return a - b;
  });
  const customer = record.customer;
  const operational = record.operationalStatus ?? record.operational_status;
  const showNdr = Boolean(
    record.ndrReason ||
      record.ndr_reason ||
      (record.ndrAttemptCount ?? record.ndr_attempt_count ?? 0) > 0 ||
      record.status === "NDR" ||
      operational === "NDR"
  );
  const showRto = Boolean(
    record.rtoInitiatedAt ||
      record.rto_initiated_at ||
      record.status === "RTO" ||
      (typeof operational === "string" && operational.startsWith("RTO"))
  );
  const returnEvents = events.filter((event) => {
    const classification = event.classification ?? "";
    const label = `${event.eventCode ?? event.event_code ?? ""} ${event.eventDescription ?? event.event_description ?? ""}`;
    return classification.startsWith("RTO") || /rto|return/i.test(label);
  });
  const article = record.trackingNumber ?? record.tracking_number ?? record.barcode;
  const bookedAt = record.bookedAt ?? record.booked_at;
  const providerError = record.lastError ?? record.last_error;
  const trackingLookupFailed = /tracking lookup failed/i.test(providerError ?? "");
  const statusValue = indiaPostDisplayShipmentStatus(record);

  return (
    <div className="space-y-6">
      <PageHeader
        title={record.trackingNumber ?? record.tracking_number ?? record.barcode ?? "Shipment"}
        description={`Created ${formatDate(record.createdAt ?? record.created_at, true)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {canSync && article ? (
              <Button type="button" variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
                <RefreshCw className="size-4" />
                Refresh tracking
              </Button>
            ) : null}
            <Button type="button" variant="secondary" onClick={() => void openCustomLabel(params.id, "preview")}>
              Preview label
            </Button>
            <Button type="button" variant="secondary" onClick={() => void openCustomLabel(params.id, "download")}>
              Download label
            </Button>
            <Button type="button" variant="secondary" onClick={() => void openCustomLabel(params.id, "print")}>
              Print label
            </Button>
            <Button type="button" variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
              <RotateCcw className="size-4" />
              Retry
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusBadge value={statusValue} />
            <p className="text-muted">
              Last synced {formatDate(record.lastTrackedAt ?? record.last_tracked_at, true)}
            </p>
            {bookedAt && trackingLookupFailed ? (
              <p className="text-muted">
                Article is booked. India Post tracking often stays empty until the first post-office scan.
              </p>
            ) : providerError ? (
              <p className="whitespace-pre-wrap break-words text-error">{providerError}</p>
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
            <p>Service: {indiaPostServiceLabel(record.serviceCode ?? record.service_code)}</p>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Order information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>Order ID: {record.orderNumber ?? record.order_number ?? "—"}</p>
            <p>Customer: {customer?.name || "—"}</p>
            <p>Phone: {customer?.phone || "—"}</p>
            <p>Order date: {formatDate(record.orderCreatedAt, true)}</p>
            <p>Order value: {formatCurrency(record.orderTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Shipment information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>India Post tracking ID: {article ?? "—"}</p>
            <p>Service: {indiaPostServiceLabel(record.serviceCode ?? record.service_code)}</p>
            <p>Origin: {record.originCity || "—"}</p>
            <p>Destination: {record.shippingCity || "—"}</p>
            <p>Pincode: {record.shippingPincode || "—"}</p>
            <div className="flex items-center gap-2">
              Current status:
              <StatusBadge value={statusValue} />
            </div>
          </CardContent>
        </Card>
      </div>

      {showNdr ? (
        <Card>
          <CardHeader>
            <CardTitle>NDR</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted">
            <p>Reason: {record.ndrReason ?? record.ndr_reason ?? "—"}</p>
            <p>Delivery attempts: {record.ndrAttemptCount ?? record.ndr_attempt_count ?? 0}</p>
            <p>Last attempt: {formatDate(record.ndrLastAttemptAt ?? record.ndr_last_attempt_at, true)}</p>
            <p>Last scan location: {record.lastScanOffice ?? record.last_scan_office ?? "—"}</p>
            <p>Customer: {[customer?.name, customer?.phone].filter(Boolean).join(" · ") || "—"}</p>
            <p>Tracking ID: {article ?? "—"}</p>
            <p>Current status: {statusValue ?? "—"}</p>
            <p>
              India Post does not expose a reattempt or address-update API on this connection. The next scan updates this
              shipment.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {showRto ? (
        <Card id="rto">
          <CardHeader>
            <CardTitle>RTO</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted">
            <p>Reason: {record.rtoReason ?? record.rto_reason ?? "—"}</p>
            <p>Initiated: {formatDate(record.rtoInitiatedAt ?? record.rto_initiated_at, true)}</p>
            <p>Current location: {record.lastScanOffice ?? record.last_scan_office ?? "—"}</p>
            <p>Tracking ID: {article ?? "—"}</p>
            {record.orderId || record.order_id ? (
              <Link href={`/dashboard/orders/${record.orderId ?? record.order_id}`} className="text-brand hover:underline">
                Original order {record.orderNumber ?? record.order_number ?? ""}
              </Link>
            ) : null}
            <div className="flex items-center gap-2">
              Delivery status: <StatusBadge value={operational ?? record.status} />
            </div>
            {returnEvents.length === 0 ? (
              <p>No return scans have been stored yet.</p>
            ) : (
              <ol className="space-y-3">
                {returnEvents.map((event, index) => (
                  <li key={event.id ?? `rto-${index}`}>
                    <p className="font-medium text-ink">
                      {event.eventDescription ?? event.event_description ?? event.eventCode ?? event.event_code}
                    </p>
                    <p className="text-xs">
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
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Invoice</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {record.invoice ? <StatusBadge value={record.invoice.status} /> : null}
          <PlanLock locked={invoicesLocked} feature={FEATURE.invoices} compact>
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
          </PlanLock>
        </CardContent>
      </Card>

      <Card id="tracking-timeline">
        <CardHeader>
          <CardTitle>Routing Steps</CardTitle>
        </CardHeader>
        <CardContent>
          <IndiaPostRouting view={buildIndiaPostRoutingView(record, events)} />
        </CardContent>
      </Card>
    </div>
  );
}

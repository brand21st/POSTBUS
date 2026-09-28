"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { ServiceToggle } from "@/components/dashboard/service-toggle";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { addressLine, customerName, lineItems, orderNumber } from "@/lib/dashboard/records";
import { formatCurrency, formatDate, formatWeightGrams } from "@/lib/format";
import { PlanLock } from "@/components/billing/plan-lock";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { api } from "@/lib/hooks/use-api";
import { usePlanEntitlements } from "@/lib/hooks/use-plan-entitlements";
import { FEATURE } from "@/modules/billing/entitlements";
import type { LineItem, OrderRecord, ShipmentRecord } from "@/types/api";

const WEIGHT_EDIT_STATUSES = new Set(["DRAFT", "QUEUED", "FAILED", "CANCELLED"]);

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const entitlements = usePlanEntitlements();
  const invoicesLocked = !entitlements.loading && !entitlements.allows(FEATURE.invoices);
  const [weightMode, setWeightMode] = useState<"auto" | "manual">("auto");
  const [itemModes, setItemModes] = useState<Record<string, "auto" | "manual">>({});
  const [draftWeights, setDraftWeights] = useState<Record<string, string>>({});
  const [manualBox, setManualBox] = useState("");

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
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    const record = order.data;
    if (!record) return;
    const next: Record<string, string> = {};
    const modes: Record<string, "auto" | "manual"> = {};
    lineItems(record).forEach((item, index) => {
      const key = item.id ?? String(index);
      const grams = Number(item.weightGrams ?? item.weight_grams);
      next[key] = Number.isFinite(grams) && grams > 0 ? String(Math.round(grams)) : "";
      modes[key] = item.weight_edited ? "manual" : "auto";
    });
    setDraftWeights(next);
    setItemModes(modes);
    const savedMode = record.parcelWeightMode ?? record.parcel_weight_mode;
    setWeightMode(savedMode === "manual" ? "manual" : "auto");
    const box = Number(record.parcelWeightGrams ?? record.parcel_weight_grams);
    setManualBox(Number.isFinite(box) && box > 0 ? String(Math.round(box)) : "");
  }, [order.data]);

  const saveWeights = useMutation({
    mutationFn: (body: {
      parcelWeightMode: "auto" | "manual";
      parcelWeightGrams?: number;
      lineItems: Array<{ id: string; weightGrams: number; weightMode: "auto" | "manual" }>;
    }) =>
      api(`/api/v1/orders/${params.id}/weights`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Weight saved.");
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
  const weightsLocked = related.some(
    (shipment) => !WEIGHT_EDIT_STATUSES.has(String(shipment.status ?? "").toUpperCase())
  );
  const draftItemGrams = (item: LineItem, index: number) => {
    const raw = draftWeights[item.id ?? String(index)];
    const grams = raw == null || raw === "" ? 0 : Number(raw);
    return Number.isFinite(grams) && grams > 0 ? grams : 0;
  };
  const autoBoxWeight = items.reduce(
    (sum, item, index) => sum + draftItemGrams(item, index) * (Number(item.quantity) || 0),
    0
  );

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
            <Row
              label="Already paid"
              value={formatCurrency(record.amountPaid ?? record.amount_paid, record.currency)}
            />
            <Row
              label="Collect on delivery"
              value={formatCurrency(record.codAmount ?? record.cod_amount, record.currency)}
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
                    <th className="pb-3">Item weight (g)</th>
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
                        <div className="flex flex-col items-start gap-2">
                          <ServiceToggle
                            label={`Item weight mode for ${item.title}`}
                            value={itemModes[item.id ?? String(index)] ?? "auto"}
                            disabled={weightsLocked}
                            options={[
                              { value: "auto", label: "Auto", title: "Use the product weight" },
                              { value: "manual", label: "Manual", title: "Type this product weight" },
                            ]}
                            onChange={(value) => {
                              const key = item.id ?? String(index);
                              const next = value === "manual" ? "manual" : "auto";
                              setItemModes((current) => ({ ...current, [key]: next }));
                            }}
                          />
                          {(itemModes[item.id ?? String(index)] ?? "auto") === "manual" ? (
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              aria-label={`Item weight for ${item.title}`}
                              disabled={weightsLocked}
                              className="h-9 w-24"
                              value={draftWeights[item.id ?? String(index)] ?? ""}
                              onChange={(event) => {
                                const key = item.id ?? String(index);
                                setDraftWeights((current) => ({ ...current, [key]: event.target.value }));
                              }}
                            />
                          ) : (
                            <p className="text-sm text-ink">
                              {draftItemGrams(item, index) > 0 ? formatWeightGrams(draftItemGrams(item, index)) : "—"}
                            </p>
                          )}
                        </div>
                      </td>
                      <td className="py-3">
                        {formatCurrency(item.unitPrice ?? item.unit_price, record.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-border pt-4">
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Box weight</p>
                  <ServiceToggle
                    label="Box weight mode"
                    value={weightMode}
                    disabled={weightsLocked}
                    options={[
                      { value: "auto", label: "Auto", title: "Sum of item weights" },
                      { value: "manual", label: "Manual", title: "Type the parcel weight India Post books" },
                    ]}
                    onChange={(value) => {
                      const next = value === "manual" ? "manual" : "auto";
                      setWeightMode(next);
                      if (next === "manual" && !manualBox && autoBoxWeight > 0) {
                        setManualBox(String(Math.round(autoBoxWeight)));
                      }
                    }}
                  />
                  {weightMode === "auto" ? (
                    <p className="text-sm text-ink">{autoBoxWeight > 0 ? formatWeightGrams(autoBoxWeight) : "—"}</p>
                  ) : (
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      aria-label="Box weight in grams"
                      disabled={weightsLocked}
                      className="h-9 w-28"
                      value={manualBox}
                      onChange={(event) => setManualBox(event.target.value)}
                    />
                  )}
                  <p className="text-xs text-muted">India Post uses this box weight for the tariff.</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={weightsLocked || saveWeights.isPending || items.some((item) => !item.id)}
                  onClick={() => {
                    if (weightMode === "manual" && !(Number(manualBox) >= 1)) {
                      toast.error("Enter the box weight in grams.");
                      return;
                    }
                    saveWeights.mutate({
                      parcelWeightMode: weightMode,
                      parcelWeightGrams: weightMode === "manual" ? Math.round(Number(manualBox)) : undefined,
                      lineItems: items.flatMap((item, index) =>
                        item.id
                          ? [
                              {
                                id: item.id,
                                weightGrams: Math.max(0, Math.round(draftItemGrams(item, index))),
                                weightMode: itemModes[item.id] ?? "auto",
                              },
                            ]
                          : []
                      ),
                    });
                  }}
                >
                  Save weight
                </Button>
              </div>
              {weightsLocked ? (
                <p className="mt-3 text-sm text-muted">Weight is locked after India Post booking.</p>
              ) : null}
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
          <PlanLock locked={invoicesLocked} feature={FEATURE.invoices} compact>
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
          </PlanLock>
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

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage, useShopifyApi } from "@/components/shopify-app/api";
import { showToast, useAppNavigate } from "@/components/shopify-app/app-bridge";
import { bookableServices, bookingBlocker, bookingDefaults, parcelPayload, type ParcelForm } from "@/components/shopify-app/booking";
import {
  formatDate,
  formatMoney,
  formatWeight,
  isShipmentActive,
  isShipmentInFlight,
  orderStatusBadge,
  paymentBadge,
  serviceLabel,
  shipmentStatusBadge,
} from "@/components/shopify-app/format";
import type { IndiaPostSettings, OrderAddress, OrderDetail, TariffQuote } from "@/components/shopify-app/types";
import { AddressModal } from "@/components/shopify-app/address-modal";
import { ErrorBanner, SectionSkeleton, StatusBadge } from "@/components/shopify-app/ui";

const POLL_MS = 3000;

function addressLines(address?: OrderAddress | null) {
  if (!address) return [];
  return [
    address.name,
    address.line1 ?? address.address1,
    address.line2 ?? address.address2,
    [address.city, address.state, address.pincode].filter(Boolean).join(", "),
    address.phone,
  ].filter((line): line is string => Boolean(line && String(line).trim()));
}

export function ShopifyOrderBookPage({ orderId }: { orderId: string }) {
  const api = useShopifyApi();
  const navigate = useAppNavigate();
  const queryClient = useQueryClient();

  const order = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => api<OrderDetail>(`orders/${orderId}`),
    // Keep polling while the worker is still talking to India Post.
    refetchInterval: (query) => (isShipmentInFlight(query.state.data?.shipment?.status) ? POLL_MS : false),
  });
  const settings = useQuery({
    queryKey: ["india-post"],
    queryFn: () => api<IndiaPostSettings>("integrations/india-post"),
  });

  // Form = prefilled defaults + whatever the merchant changed, so refetches never wipe their edits.
  const [edits, setEdits] = useState<Partial<ParcelForm>>({});
  const form = order.data && settings.data ? { ...bookingDefaults(order.data, settings.data), ...edits } : null;
  const [formError, setFormError] = useState<string | null>(null);
  const [quote, setQuote] = useState<TariffQuote | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);

  const estimate = useMutation({
    mutationFn: (payload: { serviceCode: string; weightGrams: number; lengthCm: number; widthCm: number; heightCm: number }) =>
      api<TariffQuote>(`orders/${orderId}/tariff-quote`, {
        method: "POST",
        body: {
          service: payload.serviceCode,
          weightGrams: payload.weightGrams,
          lengthCm: payload.lengthCm,
          widthCm: payload.widthCm,
          heightCm: payload.heightCm,
        },
      }),
    onSuccess: setQuote,
    onError: (error) => setFormError(errorMessage(error, "India Post couldn't estimate this parcel.")),
  });

  const book = useMutation({
    mutationFn: (payload: { serviceCode: string; weightGrams: number; lengthCm: number; widthCm: number; heightCm: number }) =>
      api<{ queued: number }>("shipments", { method: "POST", body: { orderIds: [orderId], ...payload } }),
    onSuccess: () => {
      showToast("Booking sent to India Post");
      void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (error) => setFormError(errorMessage(error, "Couldn't book this order.")),
  });

  const retry = useMutation({
    mutationFn: (shipmentId: string) => api(`shipments/${shipmentId}/retry`, { method: "POST", body: {} }),
    onSuccess: () => {
      showToast("Booking retried");
      void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
    },
    onError: (error) => showToast(errorMessage(error), { isError: true }),
  });

  function update(field: keyof ParcelForm, value: string) {
    setEdits((current) => ({ ...current, [field]: value }));
    setQuote(null);
    setFormError(null);
  }

  function submit(kind: "estimate" | "book") {
    if (!form) return;
    const parsed = parcelPayload(form);
    if (!parsed.ok) {
      setFormError(parsed.error);
      return;
    }
    setFormError(null);
    if (kind === "estimate") estimate.mutate(parsed.value);
    else book.mutate(parsed.value);
  }

  const heading = order.data ? `Order ${order.data.orderNumber}` : "Order";
  const backAction = (
    <s-link slot="breadcrumb-actions" onClick={() => navigate("/shopify/orders")}>
      Orders
    </s-link>
  );

  if (order.isError || settings.isError) {
    return (
      <s-page heading={heading}>
        {backAction}
        <ErrorBanner
          heading="Couldn't load this order"
          error={order.error ?? settings.error}
          onRetry={() => {
            void order.refetch();
            void settings.refetch();
          }}
        />
      </s-page>
    );
  }

  if (!order.data || !settings.data || !form) {
    return (
      <s-page heading={heading}>
        {backAction}
        <SectionSkeleton heading="India Post shipment" lines={5} />
        <SectionSkeleton heading="Order" lines={4} />
      </s-page>
    );
  }

  const data = order.data;
  const shipment = data.shipment;
  const blocker = bookingBlocker(data, settings.data);
  const services = bookableServices(settings.data);
  const shipmentBadge = shipment ? shipmentStatusBadge(shipment.status) : null;
  const failed = String(shipment?.status ?? "").toUpperCase() === "FAILED";

  return (
    <s-page heading={heading}>
      {backAction}
      <s-stack slot="secondary-actions" direction="inline" gap="small-200">
        <StatusBadge {...orderStatusBadge(data)} />
        <StatusBadge {...paymentBadge(data.paymentStatus)} />
      </s-stack>

      {shipment && shipmentBadge ? (
        <s-section heading="India Post shipment">
          <s-stack gap="small-300">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <StatusBadge {...shipmentBadge} />
              {isShipmentInFlight(shipment.status) ? <s-spinner size="base" accessibilityLabel="Waiting for India Post" /> : null}
            </s-stack>
            <s-text>Tracking number: {shipment.barcode ?? shipment.tracking_number ?? "assigned after booking"}</s-text>
            <s-text color="subdued">
              {serviceLabel(shipment.service_code)} · {formatWeight(shipment.weight_grams)}
              {shipment.booked_at ? ` · booked ${formatDate(shipment.booked_at)}` : ""}
            </s-text>
            {failed ? (
              <s-banner tone="critical" heading="India Post didn't accept this booking">
                <s-paragraph>{shipment.last_error || "Check the address, weight and size, then try again."}</s-paragraph>
                <s-button slot="secondary-actions" loading={retry.isPending} onClick={() => retry.mutate(shipment.id)}>
                  Try again
                </s-button>
              </s-banner>
            ) : null}
          </s-stack>
        </s-section>
      ) : null}

      {blocker ? (
        <s-banner tone={shipment ? "info" : "warning"}>
          <s-paragraph>{blocker.message}</s-paragraph>
          {blocker.href ? (
            <s-button slot="secondary-actions" onClick={() => navigate(blocker.href!)}>
              Open settings
            </s-button>
          ) : null}
        </s-banner>
      ) : null}

      {!blocker ? (
        <s-section heading="Book with India Post">
          <s-stack gap="base">
            <s-select
              label="Service"
              value={form.serviceCode}
              onChange={(event) => update("serviceCode", event.currentTarget.value)}
            >
              {services.map((option) => (
                <s-option key={option.code} value={option.code}>
                  {option.label}
                </s-option>
              ))}
            </s-select>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(120px, 1fr))" gap="base">
              <s-number-field
                label="Weight"
                suffix="g"
                min={1}
                value={form.weightGrams}
                onInput={(event) => update("weightGrams", event.currentTarget.value)}
              />
              <s-number-field
                label="Length"
                suffix="cm"
                min={1}
                max={150}
                value={form.lengthCm}
                onInput={(event) => update("lengthCm", event.currentTarget.value)}
              />
              <s-number-field
                label="Width"
                suffix="cm"
                min={1}
                max={150}
                value={form.widthCm}
                onInput={(event) => update("widthCm", event.currentTarget.value)}
              />
              <s-number-field
                label="Height"
                suffix="cm"
                min={1}
                max={150}
                value={form.heightCm}
                onInput={(event) => update("heightCm", event.currentTarget.value)}
              />
            </s-grid>

            {formError ? <s-banner tone="critical">{formError}</s-banner> : null}

            {quote ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-stack gap="small-300">
                  <s-text type="strong">{`Estimated India Post charge: ${formatMoney(quote.estimatedTotal, quote.currency)}`}</s-text>
                  <s-text color="subdued">
                    {`Base ${formatMoney(quote.baseTariff, quote.currency)}`}
                    {quote.codCharges ? ` · COD ${formatMoney(quote.codCharges, quote.currency)}` : ""}
                    {` · GST ${formatMoney(quote.totalTax, quote.currency)}`}
                    {quote.chargeableWeightGrams ? ` · charged on ${formatWeight(quote.chargeableWeightGrams)}` : ""}
                  </s-text>
                </s-stack>
              </s-box>
            ) : null}

            <s-stack direction="inline" gap="small-200" justifyContent="end">
              <s-button loading={estimate.isPending} disabled={book.isPending} onClick={() => submit("estimate")}>
                Get estimate
              </s-button>
              <s-button variant="primary" loading={book.isPending} onClick={() => submit("book")}>
                Book shipment
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading="Ship to">
        <s-stack gap="small-300">
          <s-stack gap="small-500">
            {addressLines(data.shipping_address).map((line) => (
              <s-text key={line}>{line}</s-text>
            ))}
          </s-stack>
          {!shipment || failed || !isShipmentActive(shipment.status) ? (
            <s-stack direction="inline">
              <s-button variant="tertiary" onClick={() => setEditingAddress(true)}>
                Edit address
              </s-button>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>

      <AddressModal
        key={editingAddress ? "editing" : "idle"}
        open={editingAddress}
        orderId={orderId}
        address={data.shipping_address ?? null}
        onClose={() => setEditingAddress(false)}
        onSaved={() => {
          setEditingAddress(false);
          void queryClient.invalidateQueries({ queryKey: ["order", orderId] });
        }}
      />

      <s-section heading={`Items (${data.items})`}>
        <s-stack gap="small-200">
          {(data.lineItems ?? []).map((item) => (
            <s-stack key={item.id} direction="inline" gap="base" alignItems="center" justifyContent="space-between">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {item.imageUrl ? <s-thumbnail src={item.imageUrl} alt={item.title} size="small" /> : null}
                <s-stack gap="small-500">
                  <s-text>{`${item.title} × ${item.quantity}`}</s-text>
                  <s-text color="subdued">{item.sku ? `SKU ${item.sku}` : "No SKU"}</s-text>
                </s-stack>
              </s-stack>
              <s-text color="subdued">{formatWeight(item.weight_grams)}</s-text>
            </s-stack>
          ))}
          <s-divider />
          <s-stack direction="inline" justifyContent="space-between">
            <s-text type="strong">Order total</s-text>
            <s-text type="strong">{formatMoney(data.totalAmount, data.currency ?? "INR")}</s-text>
          </s-stack>
          {String(data.paymentStatus).toUpperCase() !== "PAID" && data.codAmount ? (
            <s-stack direction="inline" justifyContent="space-between">
              <s-text color="subdued">Collect on delivery</s-text>
              <s-text>{formatMoney(data.codAmount, data.currency ?? "INR")}</s-text>
            </s-stack>
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useShopifyApi } from "@/components/shopify-app/api";
import { useAppNavigate } from "@/components/shopify-app/app-bridge";
import { BulkBookModal } from "@/components/shopify-app/bulk-book-modal";
import {
  formatDate,
  formatMoney,
  isShipmentActive,
  orderStatusBadge,
  paymentBadge,
} from "@/components/shopify-app/format";
import type { OrderList, OrderListItem } from "@/components/shopify-app/types";
import { EmptyState, ErrorBanner, StatusBadge } from "@/components/shopify-app/ui";

const PAGE_SIZE = 25;

export type OrdersTab = "to-book" | "booked" | "all";

const TABS: Array<{ id: OrdersTab; label: string }> = [
  { id: "to-book", label: "To book" },
  { id: "booked", label: "Booked" },
  { id: "all", label: "All" },
];

/** Query string for GET orders; "To book" means imported orders that have no live shipment yet. */
export function ordersQuery(tab: OrdersTab, search: string, page: number) {
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (tab === "to-book") params.set("status", "IMPORTED");
  if (tab === "booked") params.set("status", "BOOKED");
  if (search.trim()) params.set("q", search.trim());
  return `orders?${params.toString()}`;
}

export function isBookable(order: OrderListItem) {
  const status = String(order.status).toUpperCase();
  return !["CANCELLED", "DELIVERED"].includes(status) && !isShipmentActive(order.shipment?.status);
}

function useDebounced(value: string, ms = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

export function ShopifyOrdersPage() {
  const api = useShopifyApi();
  const navigate = useAppNavigate();
  const [tab, setTab] = useState<OrdersTab>("to-book");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const orders = useQuery({
    queryKey: ["orders", tab, search, page],
    queryFn: () => api<OrderList>(ordersQuery(tab, search, page)),
    placeholderData: keepPreviousData,
  });

  // A new filter shows a different set of rows, so start again from page 1 with nothing selected.
  function resetView() {
    setPage(1);
    setSelected(new Set());
  }

  const items = useMemo(() => orders.data?.items ?? [], [orders.data]);
  const bookable = items.filter(isBookable);
  const allSelected = bookable.length > 0 && bookable.every((order) => selected.has(order.id));
  const total = orders.data?.total ?? 0;
  const hasNext = page * PAGE_SIZE < total;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(bookable.map((order) => order.id)) : new Set());
  }

  return (
    <s-page heading="Orders" inlineSize="large">
      {selected.size > 0 ? (
        <s-button slot="primary-action" variant="primary" onClick={() => setBulkOpen(true)}>
          {`Book ${selected.size} ${selected.size === 1 ? "order" : "orders"}`}
        </s-button>
      ) : null}

      {orders.isError ? (
        <ErrorBanner heading="Couldn't load orders" error={orders.error} onRetry={() => orders.refetch()} />
      ) : null}

      <s-section padding="none" accessibilityLabel="Orders">
        <s-table
          paginate
          hasNextPage={hasNext}
          hasPreviousPage={page > 1}
          onNextPage={() => setPage((value) => value + 1)}
          onPreviousPage={() => setPage((value) => Math.max(1, value - 1))}
          loading={orders.isFetching}
        >
          <s-stack slot="filters" direction="inline" gap="small-200" alignItems="center">
            <s-button-group>
              {TABS.map((item) => (
                <s-button
                  key={item.id}
                  slot="secondary-actions"
                  variant={tab === item.id ? "primary" : "secondary"}
                  onClick={() => {
                    setTab(item.id);
                    resetView();
                  }}
                >
                  {item.label}
                </s-button>
              ))}
            </s-button-group>
            <s-search-field
              label="Search orders"
              labelAccessibilityVisibility="exclusive"
              placeholder="Search by order number, customer or phone"
              value={searchInput}
              onInput={(event) => {
                setSearchInput(event.currentTarget.value);
                resetView();
              }}
            />
          </s-stack>

          <s-table-header-row>
            <s-table-header>
              <s-checkbox
                label="Select all bookable orders on this page"
                labelAccessibilityVisibility="exclusive"
                checked={allSelected}
                disabled={bookable.length === 0}
                onChange={(event) => toggleAll(event.currentTarget.checked)}
              />
            </s-table-header>
            <s-table-header listSlot="primary">Order</s-table-header>
            <s-table-header>Date</s-table-header>
            <s-table-header listSlot="secondary">Customer</s-table-header>
            <s-table-header>PIN code</s-table-header>
            <s-table-header>Payment</s-table-header>
            <s-table-header format="currency">Total</s-table-header>
            <s-table-header listSlot="inline">Status</s-table-header>
            <s-table-header>Tracking number</s-table-header>
          </s-table-header-row>

          <s-table-body>
            {items.map((order) => {
              const status = orderStatusBadge(order);
              const payment = paymentBadge(order.paymentStatus);
              const canBook = isBookable(order);
              return (
                <s-table-row key={order.id} clickDelegate={`order-link-${order.id}`}>
                  <s-table-cell>
                    <s-checkbox
                      label={`Select order ${order.orderNumber}`}
                      labelAccessibilityVisibility="exclusive"
                      checked={selected.has(order.id)}
                      disabled={!canBook}
                      onChange={(event) => toggle(order.id, event.currentTarget.checked)}
                    />
                  </s-table-cell>
                  <s-table-cell>
                    <s-link id={`order-link-${order.id}`} onClick={() => navigate(`/shopify/orders/${order.id}`)}>
                      {order.orderNumber}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>{formatDate(order.createdAt)}</s-table-cell>
                  <s-table-cell>{order.customerName ?? "—"}</s-table-cell>
                  <s-table-cell>{order.shipping_address?.pincode ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <StatusBadge {...payment} />
                  </s-table-cell>
                  <s-table-cell>{formatMoney(order.totalAmount, order.currency ?? "INR")}</s-table-cell>
                  <s-table-cell>
                    <StatusBadge {...status} />
                  </s-table-cell>
                  <s-table-cell>{order.shipment?.barcode ?? "—"}</s-table-cell>
                </s-table-row>
              );
            })}
          </s-table-body>
        </s-table>
      </s-section>

      {orders.isSuccess && items.length === 0 ? (
        <EmptyState heading={tab === "to-book" && !search ? "No orders waiting to ship" : "No orders found"}>
          {tab === "to-book" && !search
            ? "New Shopify orders appear here automatically. Orders from the last 60 days are imported when you first open PostBus."
            : "Try another search or tab."}
        </EmptyState>
      ) : null}

      <BulkBookModal
        open={bulkOpen}
        orderIds={[...selected]}
        onClose={() => setBulkOpen(false)}
        onQueued={() => {
          setSelected(new Set());
          void orders.refetch();
        }}
      />
    </s-page>
  );
}

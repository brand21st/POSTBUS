"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/hooks/use-api";

type OrderRow = { id: string; orderNumber?: string; order_number?: string; customerName?: string };

export default function NewSalesInvoicePage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const orders = useQuery({
    queryKey: ["invoice-order-picker", search],
    queryFn: () => api<{ items: OrderRow[] }>(`/api/v1/orders?page=1&pageSize=10&q=${encodeURIComponent(search)}&includeCounts=0`),
  });
  const create = useMutation({
    mutationFn: (orderId: string) => api<{ id: string }>("/api/v1/sales-invoices", { method: "POST", body: JSON.stringify({ orderId }) }),
    onSuccess: (invoice) => router.push(`/dashboard/invoices/${invoice.id}`),
    onError: (error: Error) => toast.error(error.message),
  });
  const items = orders.data?.items ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Create invoice" description="Choose an existing order. Draft edits do not change India Post booking or Shopify totals." />
      <Input value={search} placeholder="Search order number" onChange={(event) => setSearch(event.target.value)} />
      <div className="space-y-2">
        {items.map((order) => (
          <div key={order.id} className="flex items-center justify-between rounded-xl border border-border p-3">
            <div>
              <p className="font-medium">{order.orderNumber ?? order.order_number ?? order.id.slice(0, 8)}</p>
              <p className="text-sm text-muted">{order.customerName || "Customer"}</p>
            </div>
            <Button type="button" size="sm" disabled={create.isPending} onClick={() => create.mutate(order.id)}>Use this order</Button>
          </div>
        ))}
        {!orders.isLoading && items.length === 0 ? <p className="text-sm text-muted">No orders match.</p> : null}
      </div>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { WhatsAppPasteParser } from "@/components/orders/whatsapp-paste-parser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/format";
import { api } from "@/lib/hooks/use-api";
import { CUSTOMER_ORDER_LINK_STATUS_LABELS, type CustomerOrderLinkStatus } from "@/types/domain";

type LinkRecord = {
  id: string;
  status: CustomerOrderLinkStatus;
  expiresAt: string;
  customerName: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  submittedAt: string | null;
  createdAt: string;
  orderId: string | null;
  orderNumber: string | null;
};

type ListResponse = {
  items: LinkRecord[];
  page: number;
  pageSize: number;
  total: number;
};

type CreatedLink = { id: string; url: string; expiresAt: string };

function shareableUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${window.location.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

const FILTERS: Array<{ id: string; label: string; status?: CustomerOrderLinkStatus }> = [
  { id: "submitted", label: "Submitted", status: "SUBMITTED" },
  { id: "waiting", label: "Waiting", status: "CREATED" },
  { id: "confirmed", label: "Confirmed", status: "CONFIRMED" },
  { id: "all", label: "All" },
];

export default function CustomerOrderLinksPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("submitted");
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [copied, setCopied] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const status = FILTERS.find((item) => item.id === filter)?.status;
  const list = useQuery({
    queryKey: ["customer-order-links", filter],
    queryFn: () =>
      api<ListResponse>(
        `/api/v1/orders/customer-links?pageSize=50${status ? `&status=${status}` : ""}`
      ),
  });

  const generate = useMutation({
    mutationFn: () => api<CreatedLink>("/api/v1/orders/customer-links", { method: "POST" }),
    onSuccess: (data) => {
      setCreated({ ...data, url: shareableUrl(data.url) });
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ["customer-order-links"] });
      toast.success("Customer link created.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create the link."),
  });

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy the link.");
    }
  }

  async function shareUrl(url: string) {
    if (navigator.share) {
      try {
        await navigator.share({ title: "PostBus order details", url, text: "Please fill in your delivery details:" });
        return;
      } catch {
        // Fall through to copy when the share sheet is cancelled or unavailable.
      }
    }
    await copyUrl(url);
  }

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer collection links"
        description="Share a one-time form. After the customer submits, choose Prepaid or COD and save as a manual order."
        actions={
          <Button size="sm" onClick={() => generate.mutate()} disabled={generate.isPending}>
            <Link2 className="size-4" />
            {generate.isPending ? "Creating…" : "Generate link"}
          </Button>
        }
      />

      {created ? (
        <Card>
          <CardHeader className="p-4">
            <CardTitle>Share this link</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 p-4 pt-0 sm:flex-row sm:items-center">
            <Input readOnly value={created.url} className="h-9 font-mono text-xs" />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => copyUrl(created.url)}>
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                Copy
              </Button>
              <Button type="button" size="sm" onClick={() => shareUrl(created.url)}>
                <Share2 className="size-4" />
                Share
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="xs"
            variant={filter === item.id ? "primary" : "secondary"}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {list.isLoading ? <p className="text-sm text-muted">Loading links…</p> : null}
      {list.isError ? (
        <p className="text-sm text-error">{list.error instanceof Error ? list.error.message : "Could not load links."}</p>
      ) : null}
      {!list.isLoading && items.length === 0 ? (
        <p className="text-sm text-muted">No customer links in this view yet. Generate a link and send it on WhatsApp.</p>
      ) : null}

      <div className="space-y-2">
        {items.map((item) => (
          <SubmissionCard
            key={item.id}
            item={item}
            open={openId === item.id}
            onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
            onConfirmed={() => queryClient.invalidateQueries({ queryKey: ["customer-order-links"] })}
          />
        ))}
      </div>
    </div>
  );
}

function SubmissionCard({
  item,
  open,
  onToggle,
  onConfirmed,
}: {
  item: LinkRecord;
  open: boolean;
  onToggle: () => void;
  onConfirmed: () => void;
}) {
  const canConfirm = item.status === "SUBMITTED";
  return (
    <Card>
      <button type="button" className="flex w-full items-start justify-between gap-3 p-4 text-left" onClick={onToggle}>
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{item.customerName || "Waiting for customer"}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {item.phone || "—"}
            {item.city ? ` · ${item.city}` : ""}
            {item.pincode ? ` · ${item.pincode}` : ""}
          </p>
          <p className="mt-1 text-xs text-muted">
            {item.submittedAt ? `Submitted ${formatDate(item.submittedAt, true)}` : `Created ${formatDate(item.createdAt, true)}`}
          </p>
        </div>
        <StatusBadge value={CUSTOMER_ORDER_LINK_STATUS_LABELS[item.status] ? item.status : item.status} />
      </button>
      {open ? (
        <CardContent className="space-y-3 border-t border-border p-4">
          {item.line1 ? (
            <p className="text-sm leading-6 text-ink">
              {item.customerName}
              <br />
              {item.phone}
              <br />
              {item.line1}
              {item.line2 ? (
                <>
                  <br />
                  {item.line2}
                </>
              ) : null}
              <br />
              {[item.city, item.state, item.pincode].filter(Boolean).join(", ")}
            </p>
          ) : (
            <p className="text-sm text-muted">The customer has not submitted details yet.</p>
          )}
          {item.orderId ? (
            <Link href={`/dashboard/orders/${item.orderId}`} className="text-sm font-medium text-brand">
              Open order {item.orderNumber || ""}
            </Link>
          ) : null}
          {item.status !== "CONFIRMED" && item.status !== "DISABLED" && item.status !== "EXPIRED" ? (
            <DisableLinkButton id={item.id} onDone={onConfirmed} />
          ) : null}
          {canConfirm ? <ConfirmPanel item={item} onConfirmed={onConfirmed} /> : null}
        </CardContent>
      ) : null}
    </Card>
  );
}

function DisableLinkButton({ id, onDone }: { id: string; onDone: () => void }) {
  const disable = useMutation({
    mutationFn: () => api(`/api/v1/orders/customer-links/${id}/disable`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Link disabled.");
      onDone();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not disable the link."),
  });
  return (
    <Button type="button" variant="ghost" size="xs" disabled={disable.isPending} onClick={() => disable.mutate()}>
      Disable link
    </Button>
  );
}

function ConfirmPanel({ item, onConfirmed }: { item: LinkRecord; onConfirmed: () => void }) {
  const [paymentType, setPaymentType] = useState<"PREPAID" | "COD">("COD");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("Manual order");
  const [customerName, setCustomerName] = useState(item.customerName ?? "");
  const [phone, setPhone] = useState(item.phone ?? "");
  const [line1, setLine1] = useState(item.line1 ?? "");
  const [line2, setLine2] = useState(item.line2 ?? "");
  const [city, setCity] = useState(item.city ?? "");
  const [state, setState] = useState(item.state ?? "");
  const [pincode, setPincode] = useState(item.pincode ?? "");

  const addressFields = useMemo(
    () => ({ name: customerName, phone, line1, line2, city, state, pincode }),
    [customerName, phone, line1, line2, city, state, pincode]
  );

  const confirm = useMutation({
    mutationFn: () =>
      api(`/api/v1/orders/customer-links/${item.id}/confirm`, {
        method: "POST",
        body: JSON.stringify({
          paymentType,
          amount: Number(amount),
          customerName,
          phone,
          line1,
          line2: line2 || undefined,
          city,
          state,
          pincode,
          lineItems: [{ title: title.trim() || "Manual order", quantity: 1, unitPrice: Number(amount) }],
        }),
      }),
    onSuccess: () => {
      toast.success("Manual order created.");
      onConfirmed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not confirm the order."),
  });

  return (
    <div className="space-y-3 rounded-xl bg-surface-soft p-3">
      <WhatsAppPasteParser
        getCurrent={() => addressFields}
        onApply={(fields) => {
          if (fields.name) setCustomerName(fields.name);
          if (fields.phone) setPhone(fields.phone);
          if (fields.line1) setLine1(fields.line1);
          if (fields.line2) setLine2(fields.line2);
          if (fields.city) setCity(fields.city);
          if (fields.state) setState(fields.state);
          if (fields.pincode) setPincode(fields.pincode);
        }}
      />
      <p className="text-xs text-muted">
        Address was collected from the customer. Payment type and amount are set here before the order is created.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={paymentType === "PREPAID" ? "primary" : "secondary"}
          onClick={() => setPaymentType("PREPAID")}
        >
          Prepaid
        </Button>
        <Button
          type="button"
          size="sm"
          variant={paymentType === "COD" ? "primary" : "secondary"}
          onClick={() => setPaymentType("COD")}
        >
          COD
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{paymentType === "COD" ? "COD collection amount" : "Order amount"}</Label>
          <Input className="mt-1.5 h-9" type="number" min={0.01} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <div>
          <Label>Item title</Label>
          <Input className="mt-1.5 h-9" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={confirm.isPending || !amount || Number(amount) <= 0}
        onClick={() => confirm.mutate()}
      >
        {confirm.isPending ? "Saving…" : "Confirm and save"}
      </Button>
    </div>
  );
}

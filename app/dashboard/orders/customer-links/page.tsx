"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Share2 } from "lucide-react";
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

type MerchantLink = {
  id: string;
  slug: string;
  url: string;
  status: "ACTIVE";
};

type PendingOrder = {
  id: string;
  orderNumber: string;
  customerName: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  createdAt: string;
};

type LegacySubmission = {
  id: string;
  customerName: string | null;
  phone: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  submittedAt: string | null;
};

type CollectionResponse = {
  link: MerchantLink;
  pending: PendingOrder[];
  legacy: LegacySubmission[];
};

function shareableUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    return `${window.location.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export default function CustomerOrderLinksPage() {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const collection = useQuery({
    queryKey: ["customer-order-links"],
    queryFn: () => api<CollectionResponse>("/api/v1/orders/customer-links"),
  });

  const linkUrl = collection.data?.link ? shareableUrl(collection.data.link.url) : "";

  async function copyUrl() {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy the link.");
    }
  }

  async function shareUrl() {
    if (!linkUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "PostBus order details",
          url: linkUrl,
          text: "Please fill in your delivery details:",
        });
        return;
      } catch {
        // Fall through to copy when the share sheet is cancelled or unavailable.
      }
    }
    await copyUrl();
  }

  const pending = collection.data?.pending ?? [];
  const legacy = collection.data?.legacy ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Customer order link"
        description="Share one permanent WhatsApp link. Every customer who submits creates a separate WhatsApp order for you to confirm as Prepaid or COD."
      />

      <Card>
        <CardHeader className="p-4">
          <CardTitle>Your WhatsApp customer order link</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 p-4 pt-0 sm:flex-row sm:items-center">
          {collection.isLoading ? (
            <p className="text-sm text-muted">Loading your link…</p>
          ) : collection.isError ? (
            <p className="text-sm text-error">
              {collection.error instanceof Error ? collection.error.message : "Could not load the link."}
            </p>
          ) : (
            <>
              <Input readOnly value={linkUrl} className="h-9 font-mono text-xs" />
              <div className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={copyUrl}>
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  Copy link
                </Button>
                <Button type="button" size="sm" onClick={shareUrl}>
                  <Share2 className="size-4" />
                  Share
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="text-sm font-semibold text-ink">WhatsApp orders</h2>
        <p className="mt-1 text-xs text-muted">Pending review — choose Prepaid or COD, then confirm.</p>
      </div>

      {collection.isLoading ? <p className="text-sm text-muted">Loading orders…</p> : null}
      {!collection.isLoading && pending.length === 0 && legacy.length === 0 ? (
        <p className="text-sm text-muted">No WhatsApp orders yet. Share your link with customers.</p>
      ) : null}

      <div className="space-y-2">
        {pending.map((item) => (
          <ReviewCard
            key={item.id}
            title={item.customerName || "WhatsApp order"}
            subtitle={`${item.phone || "—"} · ${item.orderNumber}`}
            meta={`Submitted ${formatDate(item.createdAt, true)}`}
            item={item}
            open={openId === item.id}
            onToggle={() => setOpenId((current) => (current === item.id ? null : item.id))}
            confirmPath={`/api/v1/orders/${item.id}/whatsapp-confirm`}
            onConfirmed={() => queryClient.invalidateQueries({ queryKey: ["customer-order-links"] })}
          />
        ))}
        {legacy.map((item) => (
          <ReviewCard
            key={item.id}
            title={item.customerName || "Submitted details"}
            subtitle={item.phone || "—"}
            meta={item.submittedAt ? `Submitted ${formatDate(item.submittedAt, true)}` : "Awaiting confirmation"}
            item={item}
            open={openId === `legacy-${item.id}`}
            onToggle={() => setOpenId((current) => (current === `legacy-${item.id}` ? null : `legacy-${item.id}`))}
            confirmPath={`/api/v1/orders/customer-links/${item.id}/confirm`}
            onConfirmed={() => queryClient.invalidateQueries({ queryKey: ["customer-order-links"] })}
          />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({
  title,
  subtitle,
  meta,
  item,
  open,
  onToggle,
  confirmPath,
  onConfirmed,
}: {
  title: string;
  subtitle: string;
  meta: string;
  item: {
    id: string;
    customerName: string | null;
    phone: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    orderNumber?: string;
  };
  open: boolean;
  onToggle: () => void;
  confirmPath: string;
  onConfirmed: () => void;
}) {
  return (
    <Card>
      <button type="button" className="flex w-full items-start justify-between gap-3 p-4 text-left" onClick={onToggle}>
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{title}</p>
          <p className="mt-0.5 truncate text-xs text-muted">{subtitle}</p>
          <p className="mt-1 text-xs text-muted">{meta}</p>
        </div>
        <StatusBadge value="WHATSAPP" />
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
            <p className="text-sm text-muted">Customer details are incomplete.</p>
          )}
          {item.orderNumber ? (
            <Link href={`/dashboard/orders/${item.id}`} className="text-sm font-medium text-brand">
              Open order {item.orderNumber}
            </Link>
          ) : null}
          <ConfirmPanel item={item} confirmPath={confirmPath} onConfirmed={onConfirmed} />
        </CardContent>
      ) : null}
    </Card>
  );
}

function ConfirmPanel({
  item,
  confirmPath,
  onConfirmed,
}: {
  item: {
    id: string;
    customerName: string | null;
    phone: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  confirmPath: string;
  onConfirmed: () => void;
}) {
  const [paymentType, setPaymentType] = useState<"PREPAID" | "COD">("COD");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("WhatsApp order");
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
      api(confirmPath, {
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
          lineItems: [{ title: title.trim() || "WhatsApp order", quantity: 1, unitPrice: Number(amount) }],
        }),
      }),
    onSuccess: () => {
      toast.success("WhatsApp order confirmed.");
      onConfirmed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not confirm the order."),
  });

  return (
    <div className="space-y-3 rounded-xl bg-surface-soft p-3">
      <WhatsAppPasteParser
        overwrite
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
      <p className="text-xs text-muted">Payment type is selected here. The customer does not choose Prepaid or COD.</p>
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

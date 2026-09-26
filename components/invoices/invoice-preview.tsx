"use client";

import { formatCurrency } from "@/lib/format";
import { readableTextOn, type InvoiceAppearance } from "@/modules/invoices/schema";
import type { InvoicePreviewData } from "@/types/api";

export function InvoicePreview({
  appearance,
  data,
}: {
  appearance: InvoiceAppearance;
  data: InvoicePreviewData;
}) {
  const headerText = readableTextOn(appearance.tableHeaderColor);
  const totalText = readableTextOn(appearance.totalHighlightColor);
  const billing = data.billing.name ? data.billing : data.customer;
  const shipping = data.shipping.name ? data.shipping : data.customer;

  return (
    <div
      className="mx-auto w-full max-w-[38rem] overflow-hidden rounded-lg border bg-white shadow-sm"
      style={{ color: appearance.textColor, borderColor: appearance.borderColor }}
    >
      <div className="h-1.5 w-full" style={{ background: appearance.primaryColor }} />
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-2.5">
            {data.hasLogo ? (
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded border text-[9px] font-semibold"
                style={{ borderColor: appearance.borderColor, background: appearance.secondaryColor }}
              >
                LOGO
              </div>
            ) : null}
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-tight">{data.storeName}</p>
              {data.storeAddress.map((line) => (
                <p key={line} className="text-[11px] leading-snug opacity-70">
                  {line}
                </p>
              ))}
              {data.storePhone ? <p className="text-[11px] leading-snug opacity-70">Phone {data.storePhone}</p> : null}
              {data.storeEmail ? <p className="text-[11px] leading-snug opacity-70">{data.storeEmail}</p> : null}
              {data.storeWebsite ? <p className="text-[11px] leading-snug opacity-70">{data.storeWebsite}</p> : null}
              {data.storeGstin ? <p className="text-[11px] leading-snug opacity-70">GSTIN {data.storeGstin}</p> : null}
            </div>
          </div>
          <p className="shrink-0 text-sm font-bold tracking-[0.14em]" style={{ color: appearance.primaryColor }}>
            INVOICE
          </p>
        </div>

        <div
          className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md px-3 py-2.5 text-[11px] sm:grid-cols-4"
          style={{ background: appearance.secondaryColor }}
        >
          <Meta label="Invoice No" value={data.invoiceNumber} />
          <Meta label="Invoice Date" value={data.invoiceDate} />
          <Meta label="Order No" value={data.orderNumber} />
          <Meta label="Shipment ID" value={data.shipmentNumber} />
          <Meta label="Tracking" value={data.trackingNumber} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-[11px]">
          <Party title="Bill to" party={billing} fallback={data.shipping} color={appearance.primaryColor} />
          <Party title="Ship to" party={shipping} fallback={data.billing} color={appearance.primaryColor} />
        </div>

        <table className="w-full text-[11px]">
          <thead>
            <tr style={{ background: appearance.tableHeaderColor, color: headerText }}>
              <th className="px-2 py-1.5 text-left font-semibold">Product</th>
              <th className="px-2 py-1.5 text-left font-semibold">Qty</th>
              <th className="px-2 py-1.5 text-left font-semibold">Price</th>
              <th className="px-2 py-1.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, index) => (
              <tr key={`${item.title}-${index}`} className="border-b" style={{ borderColor: appearance.borderColor }}>
                <td className="max-w-[12rem] px-2 py-1.5">
                  <span className="font-medium leading-snug">{item.title}</span>
                  {item.sku ? <span className="mt-0.5 block text-[10px] opacity-60">SKU {item.sku}</span> : null}
                </td>
                <td className="px-2 py-1.5 align-top">{item.quantity}</td>
                <td className="px-2 py-1.5 align-top">{formatCurrency(item.unitPrice, data.currency)}</td>
                <td className="px-2 py-1.5 text-right align-top">{formatCurrency(item.lineTotal, data.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-44 space-y-1 pt-2 text-[11px]">
          <Row label="Subtotal" value={formatCurrency(data.subtotal, data.currency)} />
          {data.discount ? <Row label="Discount" value={formatCurrency(data.discount, data.currency)} /> : null}
          {data.shippingAmount ? <Row label="Shipping" value={formatCurrency(data.shippingAmount, data.currency)} /> : null}
          {data.taxAmount ? <Row label="Tax" value={formatCurrency(data.taxAmount, data.currency)} /> : null}
          <div
            className="mt-3 flex items-center justify-between rounded px-2 py-1.5 font-semibold"
            style={{ background: appearance.totalHighlightColor, color: totalText }}
          >
            <span>Total</span>
            <span>{formatCurrency(data.total, data.currency)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Party({
  title,
  party,
  fallback,
  color,
}: {
  title: string;
  party: InvoicePreviewData["billing"];
  fallback: InvoicePreviewData["billing"];
  color: string;
}) {
  const lines = party.lines.length ? party.lines : fallback.lines;
  return (
    <div className="min-w-0">
      <p className="font-semibold uppercase tracking-wide" style={{ color }}>
        {title}
      </p>
      <p className="mt-1 font-medium leading-snug">{party.name || fallback.name}</p>
      {lines.map((line) => (
        <p key={line} className="leading-snug opacity-70">
          {line}
        </p>
      ))}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="opacity-60">{label}</p>
      <p className="truncate font-semibold">{value || "—"}</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="opacity-60">{label}</span>
      <span>{value}</span>
    </div>
  );
}

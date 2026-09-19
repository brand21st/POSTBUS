"use client";

import * as React from "react";
import {
  Barcode,
  FileText,
  MapPin,
  Package,
  ShoppingBag,
  Zap,
} from "lucide-react";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "shipments", label: "Shipments", icon: Package },
  { id: "labels", label: "Labels", icon: Barcode },
  { id: "manifest", label: "Manifest", icon: FileText },
  { id: "tracking", label: "Tracking", icon: MapPin },
  { id: "automation", label: "Automation", icon: Zap },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function ProductShowcase() {
  const [active, setActive] = React.useState<TabId>("orders");

  return (
    <section className="bg-white py-20 sm:py-24 lg:py-28">
      <Container>
        <SectionHeading
          eyebrow="Product experience"
          title="See the workflow in one place."
          description="Explore how PostBus organizes orders, shipments, labels, manifests, tracking and automation."
        />

        <div className="mt-10 overflow-x-auto">
          <div
            className="inline-flex min-w-full gap-2 rounded-[20px] border border-border bg-surface p-2 sm:min-w-0 sm:flex"
            role="tablist"
            aria-label="Product views"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active === tab.id}
                onClick={() => setActive(tab.id)}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-all",
                  active === tab.id
                    ? "bg-white text-ink shadow-sm"
                    : "text-muted hover:text-ink"
                )}
              >
                <tab.icon className="size-4 shrink-0" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div
          role="tabpanel"
          className="mt-6 overflow-hidden rounded-[28px] border border-border bg-surface card-shadow-lg"
        >
          {active === "orders" && <OrdersPanel />}
          {active === "shipments" && <ShipmentsPanel />}
          {active === "labels" && <LabelsPanel />}
          {active === "manifest" && <ManifestPanel />}
          {active === "tracking" && <TrackingPanel />}
          {active === "automation" && <AutomationPanel />}
        </div>
      </Container>
    </section>
  );
}

function PanelShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border-b border-border bg-white px-5 py-4 sm:px-6">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

function OrdersPanel() {
  return (
    <PanelShell title="Orders" subtitle="Synced Shopify orders ready for shipping">
      <div className="space-y-3">
        {[
          ["#10482", "Meera · Kerala", "Ready"],
          ["#10483", "Vikram · Pune", "Ready"],
          ["#10484", "Sneha · Chennai", "Needs weight"],
        ].map(([id, meta, status]) => (
          <div
            key={id}
            className="flex items-center justify-between rounded-2xl border border-border bg-white px-4 py-3"
          >
            <div>
              <p className="text-sm font-semibold text-ink">{id}</p>
              <p className="text-xs text-muted">{meta}</p>
            </div>
            <span className="rounded-full bg-brand/10 px-2.5 py-1 text-xs font-semibold text-brand">
              {status}
            </span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

function ShipmentsPanel() {
  return (
    <PanelShell title="Shipments" subtitle="Booking status across your queue">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          ["PB-88421", "Booked", "Speed Post"],
          ["PB-88422", "Draft", "Speed Post"],
          ["PB-88423", "Booked", "Registered"],
          ["PB-88424", "Processing", "Speed Post"],
        ].map(([id, status, service]) => (
          <div key={id} className="rounded-2xl border border-border bg-white p-4">
            <p className="text-sm font-semibold text-ink">{id}</p>
            <p className="mt-1 text-xs text-muted">{service}</p>
            <p className="mt-3 text-xs font-semibold text-brand">{status}</p>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

function LabelsPanel() {
  return (
    <PanelShell title="Labels" subtitle="Generate and manage shipping labels">
      <div className="rounded-2xl border border-dashed border-border bg-white p-6 text-center">
        <div className="mx-auto mb-4 flex h-28 w-40 items-center justify-center rounded-xl border border-border bg-surface font-mono text-[10px] text-muted">
          ║║║║║║║║║║║
          <br />
          PB88421IN
        </div>
        <p className="text-sm font-semibold text-ink">Label preview ready</p>
        <p className="mt-1 text-sm text-muted">Barcode and address block prepared for print</p>
      </div>
    </PanelShell>
  );
}

function ManifestPanel() {
  return (
    <PanelShell title="Manifest" subtitle="Group booked shipments for handover">
      <div className="rounded-2xl border border-border bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">Manifest · 18 Sep 2026</p>
            <p className="mt-1 text-xs text-muted">24 shipments · Pickup window set</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            Ready
          </span>
        </div>
        <div className="mt-5 space-y-2">
          {["PB-88421", "PB-88423", "PB-88425"].map((id) => (
            <div
              key={id}
              className="flex items-center justify-between rounded-xl bg-surface px-3 py-2 text-sm"
            >
              <span className="font-medium text-ink">{id}</span>
              <span className="text-muted">Included</span>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}

function TrackingPanel() {
  return (
    <PanelShell title="Tracking" subtitle="Shipment movement at a glance">
      <div className="space-y-4">
        {[
          ["Booked", "Shipment accepted", true],
          ["In transit", "Moving through network", true],
          ["Out for delivery", "Awaiting next scan", false],
        ].map(([label, detail, done]) => (
          <div key={String(label)} className="flex gap-3">
            <span
              className={cn(
                "mt-1 h-2.5 w-2.5 rounded-full",
                done ? "bg-brand" : "bg-border"
              )}
            />
            <div>
              <p className="text-sm font-semibold text-ink">{label}</p>
              <p className="text-xs text-muted">{detail}</p>
            </div>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

function AutomationPanel() {
  return (
    <PanelShell title="Automation" subtitle="Rules running on new orders">
      <div className="space-y-3">
        {[
          "Auto-create shipment on paid order",
          "Generate label after booking",
          "Sync tracking to Shopify fulfillment",
        ].map((rule) => (
          <div
            key={rule}
            className="flex items-center justify-between rounded-2xl border border-border bg-white px-4 py-3"
          >
            <p className="text-sm font-medium text-ink">{rule}</p>
            <span className="text-xs font-semibold text-emerald-600">On</span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}

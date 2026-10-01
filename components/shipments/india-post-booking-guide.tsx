"use client";

import { AlertTriangle, ChevronDown, FileText, Info, Package, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type GuideService = {
  code: string;
  title: string;
  icon: LucideIcon;
  weight: string;
  length: string;
  width: string;
  height: string;
  shape: string;
  highlightWeight?: boolean;
};

const SERVICES: GuideService[] = [
  {
    code: "SP_INLAND_DOC",
    title: "Document",
    icon: FileText,
    weight: "Up to 500 g",
    length: "1–42 cm",
    width: "1–29 cm",
    height: "1–2 cm",
    shape: "Select DOC",
    highlightWeight: true,
  },
  {
    code: "SP_INLAND_PARCEL",
    title: "Speed Post Parcel",
    icon: Package,
    weight: "Up to 35 kg",
    length: "14–150 cm",
    width: "9–150 cm",
    height: "1–150 cm",
    shape: "Normal box/rectangle: NROL",
  },
  {
    code: "BUSINESS_PARCEL",
    title: "Business Parcel",
    icon: Truck,
    weight: "Up to 35 kg",
    length: "14–150 cm",
    width: "9–150 cm",
    height: "1–150 cm",
    shape: "Normal box/rectangle: NROL",
  },
];

export function IndiaPostBookingGuide({ selectedService }: { selectedService?: string }) {
  return (
    <details className="group rounded-xl border border-amber-200 bg-amber-50/60 text-xs text-amber-950">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <AlertTriangle className="size-4 shrink-0 text-amber-600" />
        <span className="font-semibold">India Post Booking Guide</span>
        <span className="hidden truncate text-amber-800 sm:inline">
          · Documents max <strong>500 g</strong> · Parcels need L × W × H
        </span>
        <ChevronDown className="ml-auto size-4 shrink-0 text-amber-700 transition-transform group-open:rotate-180" />
      </summary>

      <IndiaPostBookingGuideBody
        selectedService={selectedService}
        className="border-t border-amber-200 px-3 pb-3 pt-2.5"
      />
    </details>
  );
}

export function IndiaPostBookingGuideBody({
  selectedService,
  className,
}: {
  selectedService?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="grid gap-2 sm:grid-cols-3">
        {SERVICES.map((service) => {
          const Icon = service.icon;
          const active = selectedService === service.code;
          return (
            <div
              key={service.code}
              className={cn(
                "rounded-lg border bg-white/80 p-2.5",
                active ? "border-brand ring-1 ring-brand/30" : "border-amber-200",
              )}
            >
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink">
                <Icon className="size-3.5 shrink-0" />
                {service.title}
                {active ? (
                  <span className="ml-auto text-[10px] font-medium normal-case text-brand">Selected</span>
                ) : null}
              </p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted">
                <dt>Weight</dt>
                <dd
                  className={cn("tabular-nums", service.highlightWeight ? "font-semibold text-amber-800" : "text-ink")}
                >
                  {service.weight}
                </dd>
                <dt>Length</dt>
                <dd className="tabular-nums text-ink">{service.length}</dd>
                <dt>Width</dt>
                <dd className="tabular-nums text-ink">{service.width}</dd>
                <dt>Height</dt>
                <dd className="tabular-nums text-ink">{service.height}</dd>
              </dl>
              <p className="mt-1.5 text-[11px] font-medium text-ink">→ {service.shape}</p>
            </div>
          );
        })}
        <p className="flex items-start gap-1.5 text-[11px] text-muted sm:col-span-2 sm:col-start-2">
          <Info className="mt-0.5 size-3 shrink-0" />
          Speed Post Parcel and Business Parcel are separate services. Select the service applicable to your
          booking/account.
        </p>
      </div>

      <div className="space-y-1 rounded-lg border border-amber-300 bg-white/80 px-2.5 py-1.5 text-center text-ink">
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-medium">
          <span>
            <span className="rounded bg-amber-200 px-1 font-bold tabular-nums text-amber-950">500 g</span> or below →{" "}
            <strong className="text-amber-900">DOCUMENT (DOC)</strong>
          </span>
          <span className="text-amber-400" aria-hidden>
            |
          </span>
          <span>
            <span className="rounded bg-brand/15 px-1 font-bold tabular-nums text-brand">501 g</span> and above →{" "}
            <strong className="text-brand">PARCEL</strong>
          </span>
        </p>
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          <span>
            <span className="font-semibold tabular-nums text-brand">501 g</span> and above →{" "}
            <strong className="text-ink">PARCEL</strong>
          </span>
          <span className="text-amber-400" aria-hidden>
            ·
          </span>
          <span>
            Normal square/rectangular parcel: <strong className="text-ink">NROL</strong>
          </span>
        </p>
      </div>

      <p className="text-[11px] text-amber-800">
        Parcel size limits are different from document limits. A box taller than 2 cm cannot go as a document.
      </p>

      <div className="rounded-lg border border-amber-300 bg-amber-100/60 p-2">
        <p className="mb-1 font-semibold uppercase tracking-wide text-amber-900">Caution</p>
        <ul className="list-disc space-y-0.5 pl-4 text-amber-900">
          <li>Weight must be entered as a whole number. Decimal values are not allowed (e.g. 500, not 500.5).</li>
          <li>For parcels, Length, Width and Height are required.</li>
          <li>Make sure the dimensions are within the limits above before booking.</li>
        </ul>
      </div>
    </div>
  );
}

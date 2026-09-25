import Link from "next/link";
import { Check } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { SectionHeading } from "@/components/ui/section-heading";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

const keepPoints = [
  "You already use India Post.",
  "You keep using India Post.",
  "PostBus makes managing it easier.",
] as const;

const setupRows = [
  { label: "Customer ID", value: "Your existing ID" },
  { label: "CEPT login", value: "Same password" },
  { label: "Service contracts", value: "Speed Post and more" },
  { label: "Barcode range", value: "Your series" },
  { label: "Pickup office", value: "Your post office" },
] as const;

export function IndiaPostSection() {
  return (
    <section id="india-post" className="bg-white py-14 sm:py-20 lg:py-24">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading
              align="left"
              eyebrow="India Post Customer ID"
              title="Use the India Post account you already have."
              description="PostBus does not replace India Post. It connects to your Customer ID so you can book, label and track without living in the carrier portal."
            />
            <ul className="mt-6 space-y-3">
              {keepPoints.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm font-medium text-ink sm:text-base">
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <Check className="size-3.5 stroke-[3]" aria-hidden="true" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
              Setup uses your Customer ID, CEPT password, service contracts, barcode range and
              pickup office — the same details your India Post account already has.
            </p>
            <Link
              href={siteConfig.getStartedUrl}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "mt-7 rounded-full")}
            >
              Connect your Customer ID
            </Link>
          </div>

          <div className="rounded-[28px] border border-border bg-surface p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
                  Your India Post setup
                </p>
                <h3 className="mt-2 text-xl font-semibold text-ink">Customer ID connected</h3>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                <Check className="size-3.5" aria-hidden="true" />
                Ready
              </span>
            </div>
            <div className="space-y-3">
              {setupRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-white px-4 py-3.5"
                >
                  <span className="text-sm text-muted">{row.label}</span>
                  <span className="text-right text-sm font-semibold text-ink">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

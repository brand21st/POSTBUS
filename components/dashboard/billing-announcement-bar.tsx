import Link from "next/link";
import { WhatsappIcon } from "@/components/layout/whatsapp-support-button";
import { buttonVariants } from "@/components/ui/button";
import {
  BILLING_ANNOUNCEMENT_COPY,
  BILLING_ANNOUNCEMENT_CTA_HREF,
  BILLING_ANNOUNCEMENT_CTA_LABEL,
  type AnnouncementPlan,
  type BillingAnnouncementPhase,
  formatAnnouncementPlans,
} from "@/lib/dashboard/billing-announcement";
import { siteConfig } from "@/lib/site-config";
import { cn } from "@/lib/utils";

export function BillingAnnouncementBar({
  phase,
  plans,
}: {
  phase: BillingAnnouncementPhase;
  plans: AnnouncementPlan[];
}) {
  const copy = BILLING_ANNOUNCEMENT_COPY[phase];
  const catalog = phase === "billing" ? formatAnnouncementPlans(plans) : [];

  return (
    <div
      role="region"
      aria-label="Billing announcement"
      aria-live="polite"
      className="border-b border-brand-dark bg-brand px-4 py-2 text-white lg:px-6"
    >
      <div className="flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-3">
        <p className="min-w-0 text-xs font-medium leading-relaxed text-white sm:text-sm">
          <span aria-hidden className="mr-1.5">
            {copy.emoji}
          </span>
          {copy.message}
        </p>
        <Link
          href={BILLING_ANNOUNCEMENT_CTA_HREF}
          prefetch={false}
          className={cn(
            buttonVariants({ variant: "secondary", size: "xs" }),
            "shrink-0 border-white/40 bg-white/10 text-white hover:bg-white/20"
          )}
        >
          {BILLING_ANNOUNCEMENT_CTA_LABEL}
        </Link>
      </div>
      <div className="mt-2 flex justify-center">
        <a
          href={`https://wa.me/${siteConfig.supportWhatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#25D366] px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1ebe5d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]"
        >
          <WhatsappIcon className="size-4" />
          WhatsApp Support
        </a>
      </div>
      {catalog.length > 0 ? (
        <ul className="mt-2 flex flex-wrap justify-center gap-1.5" aria-label="PostBus plans">
          {catalog.map((plan) => (
            <li
              key={plan.name}
              className="rounded-full border border-white/30 bg-white/10 px-2.5 py-0.5 text-[11px] font-medium text-white"
            >
              {plan.line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

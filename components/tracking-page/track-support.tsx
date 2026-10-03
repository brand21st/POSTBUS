import { Copy } from "lucide-react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TrackSupport({
  helpHref,
  onTrackAnother,
  onShare,
}: {
  helpHref?: string | null;
  onTrackAnother: () => void;
  onShare: () => void;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 text-center sm:p-6">
      <h2 className="text-base font-semibold text-ink">Need help with your shipment?</h2>
      <div className="mt-4 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        {helpHref ? (
          helpHref.startsWith("/") ? (
            <Link href={helpHref} className={cn(buttonVariants({ variant: "primary" }), "min-h-11")}>
              Contact Support
            </Link>
          ) : (
            <a
              href={helpHref}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "primary" }), "min-h-11")}
            >
              Contact Support
            </a>
          )
        ) : null}
        <Button type="button" variant="secondary" className="min-h-11" onClick={onTrackAnother}>
          Track Another Shipment
        </Button>
      </div>
      <div className="mt-5">
        <p className="text-sm font-medium text-ink">Share Tracking</p>
        <Button type="button" variant="ghost" className="mt-1 min-h-11 text-brand" onClick={onShare}>
          <Copy className="size-4" aria-hidden="true" />
          Copy tracking link
        </Button>
      </div>
    </section>
  );
}

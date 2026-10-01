import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TrackHeader({ onTrackAnother }: { onTrackAnother: () => void }) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo href="/" className="h-8 sm:h-9" priority />
          <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <p className="truncate text-sm font-medium text-ink sm:text-base">Shipment Tracking</p>
        </div>
        <nav className="flex shrink-0 items-center gap-1 sm:gap-2" aria-label="Tracking actions">
          <Link href="/contact" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 px-3")}>
            Help / Support
          </Link>
          <Button variant="secondary" size="sm" className="min-h-11 px-3" type="button" onClick={onTrackAnother}>
            Track Another Shipment
          </Button>
        </nav>
      </div>
    </header>
  );
}

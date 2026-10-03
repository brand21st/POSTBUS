import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TrackBrand =
  | { kind: "postbus" }
  | { kind: "merchant"; storeName: string; logoUrl?: string | null; accent: string };

export function TrackHeader({
  brand,
  helpHref,
  compact = false,
  onTrackAnother,
}: {
  brand: TrackBrand;
  helpHref?: string | null;
  compact?: boolean;
  onTrackAnother: () => void;
}) {
  return (
    <header className="border-b border-border bg-card">
      <div
        className={cn(
          "mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 sm:px-6",
          compact ? "py-2.5" : "py-3"
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {brand.kind === "postbus" ? (
            <Logo href="/" className="h-8 sm:h-9" priority={!compact} />
          ) : brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={brand.storeName}
              className="h-10 w-10 rounded-xl object-cover"
            />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: brand.accent }}
              aria-hidden="true"
            >
              {brand.storeName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
          <div className="min-w-0">
            {brand.kind === "merchant" ? (
              <p className="truncate text-sm font-semibold text-ink">{brand.storeName}</p>
            ) : null}
            <p className={cn("truncate text-sm font-medium text-ink", brand.kind === "merchant" && "text-xs text-muted")}>
              Shipment Tracking
            </p>
          </div>
        </div>
        <nav className="flex shrink-0 items-center gap-1 sm:gap-2" aria-label="Tracking actions">
          {helpHref ? (
            helpHref.startsWith("/") ? (
              <Link href={helpHref} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 px-3")}>
                Help / Support
              </Link>
            ) : (
              <a
                href={helpHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "min-h-11 px-3")}
              >
                Help / Support
              </a>
            )
          ) : null}
          <Button variant="secondary" size="sm" className="min-h-11 px-3" type="button" onClick={onTrackAnother}>
            Track Another Shipment
          </Button>
        </nav>
      </div>
    </header>
  );
}

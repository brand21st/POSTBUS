import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  href = "/",
  light = false,
  showTagline = false,
  priority = false,
}: {
  className?: string;
  href?: string;
  light?: boolean;
  showTagline?: boolean;
  priority?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex shrink-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        className
      )}
      aria-label="PostBus home"
    >
      <Image
        src="/images/postbus-logo-india-post-shipping.webp"
        alt="PostBus — India Post shipping management"
        width={500}
        height={200}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        sizes={showTagline ? "220px" : "120px"}
        className={cn(
          "h-9 w-auto object-contain object-left sm:h-10",
          showTagline && "h-12 sm:h-14",
          !light && "rounded-md"
        )}
      />
    </Link>
  );
}

import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Logo({
  className,
  href = "/",
  light = false,
  showTagline = false,
}: {
  className?: string;
  href?: string;
  light?: boolean;
  showTagline?: boolean;
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
        src="/src/postbus-logo.png"
        alt="PostBus"
        width={showTagline ? 220 : 160}
        height={showTagline ? 64 : 40}
        className={cn(
          "h-9 w-auto object-contain object-left sm:h-10",
          showTagline && "h-12 sm:h-14",
          // Logo asset is designed on black; soften the hard edge on light chrome
          !light && "rounded-md"
        )}
        priority
      />
    </Link>
  );
}

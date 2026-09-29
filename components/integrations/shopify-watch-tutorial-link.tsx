import type { ReactNode } from "react";
import { YoutubeIcon } from "@/components/icons/youtube-icon";
import { cn } from "@/lib/utils";

export const SHOPIFY_INTEGRATION_VIDEO_URL = "https://youtu.be/qVkpdHve7Zw";

export function WatchTutorialLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex w-fit items-center gap-2 text-sm font-medium text-brand hover:underline",
        className
      )}
    >
      <YoutubeIcon className="size-5 shrink-0 text-[#FF0000]" />
      {children}
    </a>
  );
}

export function ShopifyWatchTutorialLink({ className }: { className?: string }) {
  return (
    <WatchTutorialLink href={SHOPIFY_INTEGRATION_VIDEO_URL} className={className}>
      Watch Shopify Store Integration tutorial
    </WatchTutorialLink>
  );
}

import Image from "next/image";

import { cn } from "@/lib/utils";

export function ShopifyLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/shopify_logo_black.png"
      alt="Shopify"
      width={66}
      height={21}
      className={cn("h-[21px] w-auto object-contain", className)}
    />
  );
}

import Image from "next/image";

import { cn } from "@/lib/utils";

export function ShopifyLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/shopify-icon.png"
      alt="Shopify ecommerce platform"
      width={512}
      height={512}
      sizes="48px"
      className={cn("h-[21px] w-auto object-contain", className)}
    />
  );
}

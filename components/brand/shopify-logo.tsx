import Image from "next/image";

import { cn } from "@/lib/utils";

export function ShopifyLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/shopify_logo_black.png"
      alt="Shopify ecommerce platform"
      width={1000}
      height={286}
      sizes="100px"
      className={cn("h-[21px] w-auto object-contain", className)}
    />
  );
}

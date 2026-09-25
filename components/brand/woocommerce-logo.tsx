import Image from "next/image";

import { cn } from "@/lib/utils";

export function WooCommerceLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/woocommerce.svg"
      alt="WooCommerce"
      width={72}
      height={24}
      unoptimized
      className={cn("h-6 w-auto object-contain object-left", className)}
    />
  );
}

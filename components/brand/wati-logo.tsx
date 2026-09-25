import Image from "next/image";

import { cn } from "@/lib/utils";

export function WatiLogo({ className }: { className?: string }) {
  return (
    <Image
      src="/wati-logo-svg-format.svg"
      alt="Wati"
      width={72}
      height={24}
      unoptimized
      className={cn("h-6 w-auto object-contain object-left", className)}
    />
  );
}

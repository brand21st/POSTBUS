import { cn } from "@/lib/utils";

export function WhatsAppLogo({ className }: { className?: string }) {
  return (
    <img
      src="/WhatsApp.svg"
      alt="WhatsApp Order"
      width={175}
      height={176}
      className={cn("h-8 w-auto object-contain", className)}
    />
  );
}

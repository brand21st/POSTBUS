"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function TrialEndedModal({ open }: { open: boolean }) {
  const pathname = usePathname();
  const onBilling = pathname === "/dashboard/billing" || pathname.startsWith("/dashboard/billing/");
  return (
    <Dialog open={open && !onBilling}>
      <DialogContent showCloseButton={false} className="max-w-md rounded-2xl p-6 sm:p-8" onPointerDownOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
        <DialogTitle className="text-xl font-semibold tracking-tight text-ink">
          Your PostBus Business Trial Has Ended
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm leading-relaxed text-muted">
          Your free Business Plan trial has expired. To continue creating shipments, generating labels, and using PostBus automation, please upgrade your subscription.
        </DialogDescription>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link href="/dashboard/billing#plans" className={cn(buttonVariants({ variant: "secondary" }), "w-full sm:w-auto")}>
            View Plans
          </Link>
          <Link href="/dashboard/billing" className={cn(buttonVariants(), "w-full sm:w-auto")}>
            Upgrade Now
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

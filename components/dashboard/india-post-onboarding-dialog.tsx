"use client";

import { Plug } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { INDIA_POST_INTEGRATION_HREF } from "@/lib/dashboard/india-post-onboarding";

const STEPS = [
  { n: "1", title: "Connect your India Post Account" },
  { n: "2", title: "Configure your shipping preferences" },
  { n: "3", title: "Start creating shipments" },
];

export function IndiaPostOnboardingDialog({
  open,
  onDismiss,
}: {
  open: boolean;
  onDismiss: () => void | Promise<void>;
}) {
  const router = useRouter();

  async function goConnect() {
    await onDismiss();
    router.push(INDIA_POST_INTEGRATION_HREF);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) void onDismiss();
      }}
    >
      <DialogContent className="max-w-md animate-in fade-in zoom-in-95 duration-200">
        <DialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Plug className="size-6" />
          </div>
          <DialogTitle className="text-xl">Welcome to PostBus! 🚀</DialogTitle>
          <p className="text-sm font-medium text-ink">Let&apos;s get your shipping account ready.</p>
          <DialogDescription className="text-sm leading-relaxed">
            Before you start booking shipments and generating shipping labels, connect your India Post
            Business Account with PostBus. This is the first step to automate your India Post shipping
            operations.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-2.5">
          {STEPS.map((step) => (
            <li key={step.n} className="flex items-center gap-3 text-sm text-ink">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand">
                {step.n}
              </span>
              {step.title}
            </li>
          ))}
        </ol>
        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="secondary" onClick={() => void onDismiss()}>
            I&apos;ll Do This Later
          </Button>
          <Button type="button" variant="primary" onClick={() => void goConnect()}>
            Connect India Post →
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

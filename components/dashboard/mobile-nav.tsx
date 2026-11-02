"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Sidebar } from "@/components/dashboard/sidebar";
import type { MeResponse } from "@/types/api";

// Radix Dialog gives the drawer focus trapping, Escape to close, scroll lock and focus return.
export function MobileNav({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me?: MeResponse | null;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="drawer-overlay fixed inset-0 z-50 bg-black/40 md:hidden" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            // The trigger lives in the top bar, outside Radix's Trigger, so return focus to it by hand.
            event.preventDefault();
            document.querySelector<HTMLElement>("[data-mobile-nav-trigger]")?.focus();
          }}
          className="drawer-panel fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] shadow-[0_12px_40px_rgb(9_9_11/0.18)] focus:outline-none md:hidden"
        >
          <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="absolute right-2 top-2.5 z-10 flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            aria-label="Close menu"
          >
            <X className="size-5" />
          </DialogPrimitive.Close>
          <Sidebar me={me} onNavigate={() => onOpenChange(false)} className="w-full" />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

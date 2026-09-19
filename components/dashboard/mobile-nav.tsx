"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sidebar } from "@/components/dashboard/sidebar";
import type { MeResponse } from "@/types/api";

export function MobileNav({
  open,
  onOpenChange,
  me,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me?: MeResponse | null;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative h-full w-[280px] max-w-[85vw] shadow-[0_12px_40px_rgb(9_9_11/0.12)]">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2 top-3 z-10"
          onClick={() => onOpenChange(false)}
          aria-label="Close menu"
        >
          <X className="size-4" />
        </Button>
        <Sidebar me={me} onNavigate={() => onOpenChange(false)} className="w-full" />
      </div>
    </div>
  );
}

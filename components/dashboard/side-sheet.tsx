"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SideSheet({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="inventory-sheet-title"
        className={cn(
          "absolute inset-x-0 bottom-0 flex max-h-[94dvh] flex-col rounded-t-3xl bg-card shadow-2xl",
          "sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[min(100%,560px)] sm:max-h-none sm:rounded-none"
        )}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="inventory-sheet-title" className="text-lg font-semibold text-ink">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-full hover:bg-surface-soft"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t border-border px-5 py-4">{footer}</div> : null}
      </section>
    </div>
  );
}

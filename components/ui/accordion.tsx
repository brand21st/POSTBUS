"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

type AccordionContextValue = {
  openItems: Set<string>;
  toggle: (value: string) => void;
  type: "single" | "multiple";
};

const AccordionContext = React.createContext<AccordionContextValue | null>(null);

export function Accordion({
  children,
  type = "single",
  defaultValue,
  className,
}: {
  children: React.ReactNode;
  type?: "single" | "multiple";
  defaultValue?: string | string[];
  className?: string;
}) {
  const [openItems, setOpenItems] = React.useState<Set<string>>(() => {
    if (!defaultValue) return new Set();
    return new Set(Array.isArray(defaultValue) ? defaultValue : [defaultValue]);
  });

  const toggle = React.useCallback(
    (value: string) => {
      setOpenItems((prev) => {
        const next = new Set(prev);
        if (next.has(value)) {
          next.delete(value);
        } else {
          if (type === "single") next.clear();
          next.add(value);
        }
        return next;
      });
    },
    [type]
  );

  return (
    <AccordionContext.Provider value={{ openItems, toggle, type }}>
      <div className={cn("divide-y divide-border", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

function useAccordion() {
  const ctx = React.useContext(AccordionContext);
  if (!ctx) throw new Error("Accordion components must be used within Accordion");
  return ctx;
}

export function AccordionItem({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("py-1", className)} data-value={value}>
      {children}
    </div>
  );
}

export function AccordionTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { openItems, toggle } = useAccordion();
  const open = openItems.has(value);

  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => toggle(value)}
      className={cn(
        "flex w-full items-center justify-between gap-4 py-5 text-left text-base font-semibold text-ink transition-colors hover:text-brand sm:text-lg",
        className
      )}
    >
      <span>{children}</span>
      <ChevronDown
        className={cn(
          "size-5 shrink-0 text-muted transition-transform duration-200",
          open && "rotate-180 text-brand"
        )}
      />
    </button>
  );
}

export function AccordionContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { openItems } = useAccordion();
  const open = openItems.has(value);

  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows] duration-300 ease-out",
        open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      )}
    >
      <div className="overflow-hidden">
        <div className={cn("pb-5 text-base leading-relaxed text-muted", className)}>
          {children}
        </div>
      </div>
    </div>
  );
}

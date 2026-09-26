"use client";

import { cn } from "@/lib/utils";

export function ServiceToggle({
  value,
  options,
  disabled,
  label,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; title: string }>;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-border bg-surface p-0.5"
      onClick={(event) => event.stopPropagation()}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-md px-2 text-xs font-semibold transition-colors",
              selected ? "bg-brand text-white" : "text-muted hover:text-foreground",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

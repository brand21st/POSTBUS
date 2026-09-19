"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { indiaMobileInputDigits } from "@/lib/phone/india-whatsapp";
import { cn } from "@/lib/utils";

function IndiaFlagIcon() {
  return (
    <svg viewBox="0 0 24 16" className="h-3.5 w-[21px] shrink-0 overflow-hidden rounded-[2px] shadow-sm" aria-hidden>
      <rect width="24" height="5.33" fill="#FF9933" />
      <rect y="5.33" width="24" height="5.34" fill="#FFFFFF" />
      <rect y="10.67" width="24" height="5.33" fill="#138808" />
      <circle cx="12" cy="8" r="1.65" fill="none" stroke="#000080" strokeWidth="0.7" />
    </svg>
  );
}

type IndiaWhatsappFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  error?: string;
};

export function IndiaWhatsappField<T extends FieldValues>({
  control,
  name,
  error,
}: IndiaWhatsappFieldProps<T>) {
  return (
    <div className="space-y-2">
      <Label htmlFor="whatsapp">WhatsApp number</Label>
      <div
        className={cn(
          "flex h-11 items-stretch overflow-hidden rounded-[var(--radius-input)] border border-border bg-card shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30",
          error && "border-error"
        )}
      >
        <div className="flex items-center gap-1.5 border-r border-border bg-surface px-3 text-sm font-medium text-ink">
          <IndiaFlagIcon />
          <span>+91</span>
        </div>
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <input
              {...field}
              id="whatsapp"
              value={typeof field.value === "string" ? indiaMobileInputDigits(field.value) : ""}
              onChange={(event) => field.onChange(indiaMobileInputDigits(event.target.value))}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={16}
              placeholder="10-digit mobile"
              aria-invalid={Boolean(error)}
              className="min-w-0 flex-1 bg-transparent px-3.5 text-sm text-foreground outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
            />
          )}
        />
      </div>
      {error ? <p className="text-sm text-error">{error}</p> : null}
    </div>
  );
}

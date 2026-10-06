"use client";

import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form";
import { IndiaFlag } from "@/components/ui/india-flag";
import { Label } from "@/components/ui/label";
import { indiaMobileInputDigits } from "@/lib/phone/india-whatsapp";
import { cn } from "@/lib/utils";

type IndiaWhatsappFieldProps<T extends FieldValues> = {
  control: Control<T>;
  name: FieldPath<T>;
  error?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  size?: "default" | "lg";
};

export function IndiaWhatsappField<T extends FieldValues>({
  control,
  name,
  error,
  id = "whatsapp",
  label = "WhatsApp number",
  placeholder = "10-digit WhatsApp number",
  size = "default",
}: IndiaWhatsappFieldProps<T>) {
  const large = size === "lg";
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className={large ? "text-sm" : undefined}>
        {label}
      </Label>
      <div
        className={cn(
          "flex items-stretch overflow-hidden rounded-[var(--radius-input)] border border-border bg-card shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30",
          large ? "h-12" : "h-11",
          error && "border-error"
        )}
      >
        <div
          className={cn(
            "flex items-center gap-1.5 border-r border-border bg-surface px-3 font-medium text-ink",
            large ? "text-base" : "text-sm"
          )}
        >
          <IndiaFlag className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgb(9_9_11/0.08)]" />
          <span>+91</span>
        </div>
        <Controller
          control={control}
          name={name}
          render={({ field }) => (
            <input
              {...field}
              id={id}
              value={typeof field.value === "string" ? indiaMobileInputDigits(field.value) : ""}
              onChange={(event) => field.onChange(indiaMobileInputDigits(event.target.value))}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              placeholder={placeholder}
              aria-invalid={Boolean(error)}
              className={cn(
                "min-w-0 flex-1 bg-transparent px-3.5 text-foreground outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500",
                large ? "text-base" : "text-sm"
              )}
            />
          )}
        />
      </div>
      {error ? <p className="text-sm text-error">{error}</p> : null}
    </div>
  );
}

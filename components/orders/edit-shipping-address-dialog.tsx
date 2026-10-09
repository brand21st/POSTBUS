"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PincodeLocationHint } from "@/components/address/pincode-location-hint";
import { IndiaWhatsappField } from "@/components/auth/india-whatsapp-field";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IndiaFlag } from "@/components/ui/india-flag";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_INDIAN_STATE, INDIAN_STATE_OPTIONS, INDIAN_STATES } from "@/lib/indian-states";
import type { IndiaPostDirectoryLookup } from "@/lib/india-post/pincode-directory";
import { api } from "@/lib/hooks/use-api";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import type { AddressSummary } from "@/types/api";

const schema = z.object({
  name: z.string().min(2, "Customer name is required."),
  phone: z
    .string()
    .refine((value) => extractIndiaMobileDigits(value) !== null, "Enter a 10-digit Indian mobile number."),
  line1: z.string().min(3, "Address is required."),
  line2: z.string().optional(),
  city: z.string().min(2, "City is required."),
  state: z.string().min(2, "State is required."),
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6-digit pincode."),
  country: z.string().min(2),
});

type FormValues = z.infer<typeof schema>;

function listedIndianState(value: string) {
  const normalized = value.trim().toLowerCase();
  return INDIAN_STATES.find((state) => state.toLowerCase() === normalized) ?? value.trim();
}

function valuesFromAddress(address?: AddressSummary | null): FormValues {
  const phone = extractIndiaMobileDigits(address?.phone ?? "") ?? address?.phone ?? "";
  const state = listedIndianState(address?.state ?? "") || DEFAULT_INDIAN_STATE;
  return {
    name: address?.name?.trim() || "",
    phone,
    line1: address?.line1 ?? "",
    line2: address?.line2 ?? "",
    city: address?.city ?? "",
    state,
    pincode: String(address?.pincode ?? "").replace(/\D/g, "").slice(0, 6),
    country: "IN",
  };
}

export function EditShippingAddressDialog({
  open,
  onOpenChange,
  orderId,
  address,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  address?: AddressSummary | null;
  onSaved: () => void;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valuesFromAddress(address),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(valuesFromAddress(address));
  }, [address, form, open]);

  const save = useMutation({
    mutationFn: (body: FormValues) =>
      api(`/api/v1/orders/${orderId}/address`, {
        method: "PATCH",
        body: JSON.stringify({
          name: body.name.trim(),
          phone: extractIndiaMobileDigits(body.phone) ?? body.phone,
          line1: body.line1.trim(),
          line2: body.line2?.trim() || undefined,
          city: body.city.trim(),
          state: body.state.trim(),
          pincode: body.pincode.trim(),
          country: "IN",
        }),
      }),
    onSuccess: () => {
      toast.success("Shipping address saved.");
      onOpenChange(false);
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit shipping address</DialogTitle>
          <DialogDescription>This address is used for India Post booking.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <Field label="Customer name" error={form.formState.errors.name?.message}>
            <Input className="h-9" autoComplete="name" placeholder="Customer name" {...form.register("name")} />
          </Field>
          <Field label="Phone" error={form.formState.errors.phone?.message}>
            <IndiaWhatsappField
              control={form.control}
              name="phone"
              id="edit-shipping-phone"
              size="sm"
              hideLabel
              hideError
              error={form.formState.errors.phone?.message}
              placeholder="10-digit mobile number"
            />
          </Field>
          <Field
            label="Address"
            className="md:col-span-2"
            hint="House, building, and street — required for booking."
            error={form.formState.errors.line1?.message}
          >
            <Input
              className="h-9"
              autoComplete="address-line1"
              placeholder="House / building, street"
              {...form.register("line1")}
            />
          </Field>
          <Field
            label="Area / locality"
            className="md:col-span-2"
            hint="Optional. Landmark or extra address — not required for India Post booking."
          >
            <Input
              className="h-9"
              autoComplete="address-line2"
              placeholder="Landmark, area (optional)"
              {...form.register("line2")}
            />
          </Field>
          <Field label="Pincode" error={form.formState.errors.pincode?.message}>
            <Input
              className="h-9 tabular-nums tracking-wide"
              inputMode="numeric"
              maxLength={6}
              autoComplete="postal-code"
              placeholder="6-digit pincode"
              {...form.register("pincode")}
            />
            <PincodeLookup control={form.control} setValue={form.setValue} />
          </Field>
          <Field label="City" error={form.formState.errors.city?.message}>
            <Input className="h-9" {...form.register("city")} />
          </Field>
          <Field label="State" error={form.formState.errors.state?.message}>
            <Controller
              control={form.control}
              name="state"
              render={({ field, fieldState }) => (
                <Combobox
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  options={INDIAN_STATE_OPTIONS}
                  placeholder="Search state"
                  emptyText="No state matches your search"
                  aria-invalid={Boolean(fieldState.error)}
                />
              )}
            />
          </Field>
          <Field label="Country">
            <input type="hidden" {...form.register("country")} />
            <div
              aria-readonly="true"
              title="Shipping is available within India only"
              className="flex h-9 w-full cursor-not-allowed select-none items-center gap-2.5 rounded-[var(--radius-input)] border border-border bg-surface-soft px-3.5 text-sm text-foreground"
            >
              <IndiaFlag className="h-3.5 w-5 shrink-0 rounded-[2px] shadow-[0_0_0_1px_rgb(9_9_11/0.08)]" />
              <span className="font-medium">India</span>
              <Lock className="ml-auto size-3.5 text-muted" aria-hidden />
            </div>
          </Field>
          <DialogFooter className="md:col-span-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={save.isPending}>
              Save address
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PincodeLookup({
  control,
  setValue,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  setValue: ReturnType<typeof useForm<FormValues>>["setValue"];
}) {
  const value = useWatch({ control, name: "pincode" });
  const pincode = String(value ?? "").replace(/\D/g, "");
  const ready = /^[1-9][0-9]{5}$/.test(pincode);
  const filledFor = useRef("");
  const lookup = useQuery({
    queryKey: ["india-post", "directory", pincode],
    queryFn: () =>
      api<IndiaPostDirectoryLookup>(`/api/v1/auth/pincode?pincode=${encodeURIComponent(pincode)}`),
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const office = lookup.data?.offices?.[0];
  useEffect(() => {
    if (!office || filledFor.current === pincode) return;
    filledFor.current = pincode;
    const city = office.city.trim();
    const state = listedIndianState(office.state ?? "");
    if (city) setValue("city", city, { shouldDirty: true, shouldValidate: true });
    if (state) setValue("state", state, { shouldDirty: true, shouldValidate: true });
  }, [office, pincode, setValue]);

  if (!ready) return null;

  return (
    <PincodeLocationHint
      loading={lookup.isPending}
      error={
        lookup.isError
          ? lookup.error instanceof Error
            ? lookup.error.message
            : "Could not look up this pincode."
          : null
      }
      offices={lookup.data?.offices}
    />
  );
}

function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {error ? <p className="mt-1 text-sm text-error">{error}</p> : null}
    </div>
  );
}

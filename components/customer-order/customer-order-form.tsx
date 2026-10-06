"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { PincodeLocationHint } from "@/components/address/pincode-location-hint";
import { IndiaWhatsappField } from "@/components/auth/india-whatsapp-field";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/hooks/use-api";
import { DEFAULT_INDIAN_STATE, INDIAN_STATE_OPTIONS, INDIAN_STATES } from "@/lib/indian-states";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import type { PublicLinkView, PublicPincodeLookup } from "@/modules/customer-order-links/public";
import { publicOrderLinkApiPath } from "@/modules/customer-order-links/schema";

const formSchema = z.object({
  customerName: z.string().trim().min(2, "Name is required."),
  phone: z
    .string()
    .trim()
    .min(8, "Mobile number is required.")
    .refine((value) => extractIndiaMobileDigits(value) !== null, "Enter a 10-digit Indian WhatsApp number."),
  line1: z.string().trim().min(3, "Address is required."),
  line2: z.string().trim().optional(),
  city: z.string().trim().min(2, "City is required."),
  state: z.string().trim().min(2, "State is required."),
  pincode: z.string().trim().regex(/^\d{6}$/, "Enter a 6-digit PIN code."),
});

type FormValues = z.infer<typeof formSchema>;

function VerifiedTick() {
  return (
    <div className="relative mx-auto flex size-28 items-center justify-center" aria-hidden>
      <span className="order-verified-ring absolute inset-0 rounded-full border-2 border-white/50" />
      <span className="order-verified-ring order-verified-ring-delay absolute inset-2 rounded-full border-2 border-white/35" />
      <span className="order-verified-badge relative flex size-20 items-center justify-center rounded-full bg-white shadow-[0_12px_32px_rgb(6_95_40_/_0.28)]">
        <svg viewBox="0 0 64 64" className="size-14 text-success" fill="none">
          <circle className="order-verified-circle" cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="3" />
          <path
            className="order-verified-check"
            d="M18.5 33.5 27.2 42 45.5 22.5"
            stroke="currentColor"
            strokeWidth="4.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  );
}

function StatusScreen({
  title,
  body,
  verified = false,
}: {
  title: string;
  body: string;
  verified?: boolean;
}) {
  if (verified) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="order-verified-card overflow-hidden rounded-2xl bg-success p-8 text-center shadow-sm sm:p-10"
      >
        <VerifiedTick />
        <p className="order-verified-copy mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-white/80">
          Verified
        </p>
        <h1 className="order-verified-copy mt-2 text-xl font-semibold text-white text-balance">{title}</h1>
        <p className="order-verified-copy mt-2 text-sm leading-6 text-white/85">{body}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted">{body}</p>
    </div>
  );
}

export function CustomerOrderForm({
  token,
  workspace,
  publicId,
}: {
  token?: string;
  workspace?: string;
  publicId?: string;
}) {
  const linkRef = { token, workspace, publicId };
  const apiPath = publicOrderLinkApiPath(linkRef);
  const validToken = Boolean(apiPath);
  const [done, setDone] = useState(false);
  const link = useQuery({
    queryKey: ["public-order-link", apiPath],
    enabled: validToken,
    queryFn: () => api<PublicLinkView>(apiPath!),
    retry: false,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: "",
      phone: "",
      line1: "",
      line2: "",
      city: "",
      state: DEFAULT_INDIAN_STATE,
      pincode: "",
    },
  });

  const heading = useMemo(() => {
    const name = link.data?.merchantName?.trim();
    return name ? `Delivery details for ${name}` : "Share your delivery details";
  }, [link.data?.merchantName]);

  if (!validToken || link.isError) {
    const message = link.error instanceof ApiError ? link.error.message : "This link is not valid.";
    return <StatusScreen title="This link is not valid" body={message} />;
  }

  if (link.isLoading || !link.data) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted shadow-sm">
        Loading form…
      </div>
    );
  }

  if (done) {
    return (
      <StatusScreen
        verified
        title="Your details have been submitted successfully."
        body="You can close this page."
      />
    );
  }

  if (link.data.status === "SUBMITTED") {
    return (
      <StatusScreen
        verified
        title="Your details have already been submitted."
        body="This link has already been used. You can close this page."
      />
    );
  }

  if (link.data.status === "EXPIRED") {
    return (
      <StatusScreen
        title="This link has expired"
        body="Ask the sender for a new PostBus order link."
      />
    );
  }

  if (link.data.status === "DISABLED") {
    return (
      <StatusScreen
        title="This link is no longer available"
        body="Ask the sender for a new PostBus order link."
      />
    );
  }

  async function onSubmit(values: FormValues) {
    try {
      await api(publicOrderLinkApiPath(linkRef, "submit")!, {
        method: "POST",
        body: JSON.stringify(values),
      });
      setDone(true);
    } catch (error) {
      form.setError("root", {
        message: error instanceof Error ? error.message : "Could not submit your details.",
      });
    }
  }

  return (
    <form
      className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <div>
        <h1 className="text-xl font-semibold text-ink">{heading}</h1>
        <p className="mt-1 text-sm text-muted">Enter the address where this parcel should be delivered.</p>
      </div>

      <Field label="Customer name" error={form.formState.errors.customerName?.message}>
        <Input className="h-12 text-base" autoComplete="name" {...form.register("customerName")} />
      </Field>
      <IndiaWhatsappField
        control={form.control}
        name="phone"
        id="customer-whatsapp"
        error={form.formState.errors.phone?.message}
        size="lg"
      />
      <Field label="Address" error={form.formState.errors.line1?.message}>
        <Input className="h-12 text-base" autoComplete="address-line1" {...form.register("line1")} />
      </Field>
      <Field label="Area / locality">
        <Input className="h-12 text-base" autoComplete="address-line2" {...form.register("line2")} />
      </Field>
      <Field label="PIN code" error={form.formState.errors.pincode?.message}>
        <Input
          className="h-12 text-base tabular-nums tracking-wide"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={6}
          placeholder="6-digit PIN"
          {...form.register("pincode")}
        />
        <CustomerPincodeLookup linkRef={linkRef} form={form} />
      </Field>
      <Field label="City" error={form.formState.errors.city?.message}>
        <Input className="h-12 text-base" autoComplete="address-level2" {...form.register("city")} />
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

      {form.formState.errors.root?.message ? (
        <p className="text-sm text-error">{form.formState.errors.root.message}</p>
      ) : null}

      <Button type="submit" size="lg" className="h-12 w-full text-base" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}

function matchListedState(value: string) {
  const compact = value.trim().toLowerCase();
  if (!compact) return null;
  return INDIAN_STATES.find((state) => state.toLowerCase() === compact) ?? null;
}

function CustomerPincodeLookup({
  linkRef,
  form,
}: {
  linkRef: { token?: string; workspace?: string; publicId?: string };
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  const value = useWatch({ control: form.control, name: "pincode" });
  const pincode = String(value ?? "").replace(/\D/g, "");
  const ready = /^\d{6}$/.test(pincode);
  const lookup = useQuery({
    queryKey: ["public-order-pincode", linkRef, pincode],
    queryFn: () => {
      const base = publicOrderLinkApiPath(linkRef, "pincode");
      if (!base) throw new Error("This link is not valid.");
      const join = base.includes("?") ? "&" : "?";
      return api<PublicPincodeLookup>(`${base}${join}pincode=${encodeURIComponent(pincode)}`);
    },
    enabled: ready,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const office = lookup.data?.offices?.[0];
  useEffect(() => {
    if (!office) return;
    if (office.city && form.getValues("city").trim() !== office.city) {
      form.setValue("city", office.city, { shouldDirty: true, shouldValidate: true });
    }
    const state = matchListedState(office.state) ?? office.state.trim();
    if (state && form.getValues("state") !== state) {
      form.setValue("state", state, { shouldDirty: true, shouldValidate: true });
    }
  }, [form, office]);

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
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-sm">{label}</Label>
      <div className="mt-1.5">{children}</div>
      {error ? <p className="mt-1 text-sm text-error">{error}</p> : null}
    </div>
  );
}

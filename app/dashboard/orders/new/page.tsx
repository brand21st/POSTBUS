"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Lock, Minus, Plus, Trash2 } from "lucide-react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard/page-header";
import { ShipmentPackPresets } from "@/components/orders/shipment-pack-presets";
import { WhatsAppPasteParser } from "@/components/orders/whatsapp-paste-parser";
import { PincodeLocationHint } from "@/components/address/pincode-location-hint";
import { IndiaPostBookingGuide } from "@/components/shipments/india-post-booking-guide";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox } from "@/components/ui/combobox";
import { IndiaWhatsappField } from "@/components/auth/india-whatsapp-field";
import { IndiaFlag } from "@/components/ui/india-flag";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, toSearchParams } from "@/lib/hooks/use-api";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEFAULT_INDIAN_STATE, INDIAN_STATE_OPTIONS, INDIAN_STATES } from "@/lib/indian-states";
import type { IndiaPostDirectoryLookup } from "@/lib/india-post/pincode-directory";
import { extractIndiaMobileDigits } from "@/lib/phone/india-whatsapp";
import { selectableIndiaPostServices } from "@/modules/india-post/contracts";
import { optionalDimensionCm, optionalPositiveInt } from "@/modules/orders/schema";
import { DEFAULT_INDIA_POST_SERVICE, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from "@/types/domain";
import type { IndiaPostConfig, Paginated, ProductRecord } from "@/types/api";
import { catalogCodAdvancePaid } from "@/modules/products/payment";

const addressSchema = z.object({
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

const schema = z.object({
  orderNumber: z.string().optional(),
  customerName: z
    .string()
    .optional()
    .refine((value) => !value?.trim() || value.trim().length >= 2, "Name is too short."),
  customerPhone: z
    .string()
    .optional()
    .refine(
      (value) => !value?.trim() || extractIndiaMobileDigits(value) !== null,
      "Enter a 10-digit Indian mobile number."
    ),
  customerEmail: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.union([z.literal(""), z.email("Enter a valid email.")]).optional()
  ),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  amountPaid: z.coerce.number().min(0).optional(),
  shippingAddress: addressSchema,
  billingSameAsShipping: z.boolean(),
  billingAddress: addressSchema.optional(),
  lineItems: z
    .array(
      z.object({
        productId: z.preprocess(
          (value) => (value === "" ? undefined : value),
          z.string().uuid().optional()
        ),
        title: z.string().min(1, "Item title is required."),
        sku: z.string().optional(),
        quantity: z.coerce.number().int().min(1),
        unitPrice: z.coerce.number().min(0),
        weightGrams: z.coerce.number().int().min(0).optional(),
      })
    )
    .min(1, "Add at least one line item."),
  createShipment: z.boolean(),
  shipment: z
    .object({
      weightGrams: optionalPositiveInt,
      lengthCm: optionalDimensionCm,
      widthCm: optionalDimensionCm,
      heightCm: optionalDimensionCm,
      serviceCode: z.string().optional(),
    })
    .optional(),
}).superRefine((value, ctx) => {
  if (value.paymentStatus !== "PARTIAL") return;
  const total = value.lineItems.reduce(
    (sum, item) => sum + Number(item.unitPrice || 0) * Number(item.quantity || 0),
    0
  );
  const paid = Number(value.amountPaid || 0);
  if (paid <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amountPaid"],
      message: "Enter how much the customer already paid.",
    });
  } else if (paid >= total && total > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["amountPaid"],
      message: "Partial payment must be less than the order total.",
    });
  }
});

type FormValues = z.infer<typeof schema>;

export default function NewOrderPage() {
  const router = useRouter();
  const indiaPost = useQuery({
    queryKey: ["integrations", "india-post"],
    queryFn: () => api<IndiaPostConfig>("/api/v1/integrations/india-post"),
  });
  const catalog = useQuery({
    queryKey: ["products", "order-picker"],
    queryFn: () =>
      api<Paginated<ProductRecord>>(`/api/v1/products?${toSearchParams({ page: 1, pageSize: 100, active: "true" })}`),
  });
  const serviceOptions = useMemo(
    () => selectableIndiaPostServices(indiaPost.data),
    [indiaPost.data]
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      orderNumber: "",
      customerName: "",
      customerPhone: "",
      customerEmail: "",
      paymentStatus: "PAID",
      amountPaid: 0,
      billingSameAsShipping: true,
      shippingAddress: {
        name: "",
        phone: "",
        line1: "",
        line2: "",
        city: "",
        state: DEFAULT_INDIAN_STATE,
        pincode: "",
        country: "IN",
      },
      lineItems: [{ productId: undefined, title: "", sku: "", quantity: 1, unitPrice: 0, weightGrams: 0 }],
      createShipment: true,
      shipment: { serviceCode: DEFAULT_INDIA_POST_SERVICE },
    },
  });

  const serviceTouched = useRef(false);
  const customerPanel = useRef<HTMLDetailsElement>(null);
  const items = useFieldArray({ control: form.control, name: "lineItems" });
  // React Hook Form watch() is incompatible with the compiler memoization pass.
  // eslint-disable-next-line react-hooks/incompatible-library -- form.watch subscription
  const billingSame = form.watch("billingSameAsShipping");
  const createShipment = form.watch("createShipment");
  const paymentStatus = form.watch("paymentStatus");
  const amountPaid = Number(form.watch("amountPaid") || 0);
  const lineItemValues = form.watch("lineItems");
  const selectedService = form.watch("shipment.serviceCode");
  const shipmentWeight = form.watch("shipment.weightGrams");
  const shipmentLength = form.watch("shipment.lengthCm");
  const shipmentWidth = form.watch("shipment.widthCm");
  const shipmentHeight = form.watch("shipment.heightCm");
  const catalogItems = catalog.data?.items ?? [];
  const catalogById = useMemo(
    () => new Map(catalogItems.map((item) => [item.id, item])),
    [catalogItems]
  );
  const orderTotal = (lineItemValues ?? []).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  );
  const totalQuantity = (lineItemValues ?? []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalWeight = (lineItemValues ?? []).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.weightGrams || 0),
    0
  );

  function stepQuantity(index: number, delta: number) {
    const current = Number(form.getValues(`lineItems.${index}.quantity`) || 0);
    form.setValue(`lineItems.${index}.quantity`, Math.max(1, current + delta), { shouldDirty: true });
  }

  function addLineItem() {
    items.append(
      { title: "", sku: "", quantity: 1, unitPrice: 0, weightGrams: 0, productId: undefined },
      { shouldFocus: true, focusName: `lineItems.${items.fields.length}.title` }
    );
  }

  function applyCatalogProduct(index: number, productId: string) {
    if (!productId) {
      form.setValue(`lineItems.${index}.productId`, undefined, { shouldDirty: true });
      return;
    }
    const product = catalogById.get(productId);
    if (!product) return;
    form.setValue(`lineItems.${index}.productId`, product.id, { shouldDirty: true });
    form.setValue(`lineItems.${index}.title`, product.name, { shouldDirty: true });
    form.setValue(`lineItems.${index}.sku`, product.sku, { shouldDirty: true });
    form.setValue(`lineItems.${index}.unitPrice`, product.price, { shouldDirty: true });
    form.setValue(`lineItems.${index}.weightGrams`, product.weightGrams, { shouldDirty: true });
  }

  const catalogCodPreview = catalogCodAdvancePaid(
    (lineItemValues ?? []).map((item) => {
      const product = item.productId ? catalogById.get(item.productId) : null;
      return {
        unitPrice: Number(item.unitPrice || 0),
        quantity: Number(item.quantity || 0),
        product: product
          ? {
              prepaidEnabled: product.prepaidEnabled,
              codEnabled: product.codEnabled,
              codAdvancePercent: product.codAdvancePercent,
            }
          : null,
      };
    })
  );
  const allCatalogLines = (lineItemValues ?? []).every((item) => Boolean(item.productId));
  const collectOnDelivery =
    paymentStatus === "COD"
      ? allCatalogLines && catalogCodPreview > 0
        ? Math.max(0, orderTotal - catalogCodPreview)
        : orderTotal
      : paymentStatus === "PARTIAL"
        ? Math.max(0, orderTotal - amountPaid)
        : 0;

  useEffect(() => {
    if (!serviceOptions.length || serviceTouched.current) return;
    const preferred = serviceOptions.find((item) => item.isDefault)?.code ?? serviceOptions[0]?.code;
    if (preferred && form.getValues("shipment.serviceCode") !== preferred) {
      form.setValue("shipment.serviceCode", preferred);
    }
  }, [form, serviceOptions]);

  const customerFieldError =
    form.formState.errors.customerName ||
    form.formState.errors.customerPhone ||
    form.formState.errors.customerEmail;
  useEffect(() => {
    if (customerFieldError && customerPanel.current) customerPanel.current.open = true;
  }, [customerFieldError]);

  async function onSubmit(values: FormValues) {
    try {
      const created = await api<{ id: string }>("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify({
          orderNumber: undefined,
          customer: {
            name: values.customerName?.trim() || values.shippingAddress.name,
            phone:
              extractIndiaMobileDigits(values.customerPhone ?? "") ??
              extractIndiaMobileDigits(values.shippingAddress.phone) ??
              values.shippingAddress.phone,
            email: values.customerEmail || undefined,
          },
          shippingAddress: {
            ...values.shippingAddress,
            phone: extractIndiaMobileDigits(values.shippingAddress.phone) ?? values.shippingAddress.phone,
          },
          billingSameAsShipping: values.billingSameAsShipping,
          billingAddress: values.billingSameAsShipping
            ? undefined
            : values.billingAddress
              ? {
                  ...values.billingAddress,
                  phone:
                    extractIndiaMobileDigits(values.billingAddress.phone) ?? values.billingAddress.phone,
                }
              : undefined,
          paymentStatus: values.paymentStatus,
          amountPaid:
            values.paymentStatus === "PARTIAL"
              ? Number(values.amountPaid || 0)
              : undefined,
          lineItems: values.lineItems.map((item) =>
            item.productId
              ? { productId: item.productId, quantity: item.quantity }
              : {
                  title: item.title,
                  sku: item.sku,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  weightGrams: item.weightGrams,
                }
          ),
          createShipment: true,
          shipment: values.shipment,
        }),
      });
      toast.success("Order saved. India Post booking started.");
      router.push(`/dashboard/orders/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the order.");
    }
  }

  return (
    <form
      className="space-y-4 pb-20 xl:pb-0"
      onSubmit={form.handleSubmit(onSubmit, () => {
        toast.error("Please check the highlighted fields.");
      })}
    >
      <PageHeader
        title="Add order"
        description="Create a manual order with customer, address, and line items."
        actions={
          <Button type="submit" size="sm" className="hidden xl:inline-flex" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Booking…" : "Book now"}
          </Button>
        }
      />

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start xl:gap-6">
      <div className="space-y-4">

      <WhatsAppPasteParser
        getCurrent={() => ({
          name: form.getValues("customerName"),
          phone: form.getValues("customerPhone"),
          email: form.getValues("customerEmail"),
          line1: form.getValues("shippingAddress.line1"),
          line2: form.getValues("shippingAddress.line2"),
          city: form.getValues("shippingAddress.city"),
          state: form.getValues("shippingAddress.state"),
          pincode: form.getValues("shippingAddress.pincode"),
        })}
        onApply={(fields) => {
          if (fields.name) {
            form.setValue("customerName", fields.name, { shouldDirty: true });
            if (!form.getValues("shippingAddress.name")) {
              form.setValue("shippingAddress.name", fields.name, { shouldDirty: true });
            }
          }
          if (fields.phone) {
            form.setValue("customerPhone", fields.phone, { shouldDirty: true });
            if (!form.getValues("shippingAddress.phone")) {
              form.setValue("shippingAddress.phone", fields.phone, { shouldDirty: true });
            }
          }
          if (fields.email && !String(form.getValues("customerEmail") ?? "").trim()) {
            form.setValue("customerEmail", fields.email, { shouldDirty: true });
          }
          if (fields.line1) form.setValue("shippingAddress.line1", fields.line1, { shouldDirty: true });
          if (fields.line2) form.setValue("shippingAddress.line2", fields.line2, { shouldDirty: true });
          if (fields.city) form.setValue("shippingAddress.city", fields.city, { shouldDirty: true });
          if (fields.state) form.setValue("shippingAddress.state", fields.state, { shouldDirty: true });
          if (fields.pincode) form.setValue("shippingAddress.pincode", fields.pincode, { shouldDirty: true });
        }}
      />

      <Card>
        <CardHeader className="p-4">
          <CardTitle>Order</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-2">
          <Field label="Order number" hint="A unique PB number is assigned when you book.">
            <div className="relative">
              <Input
                className="h-9 cursor-not-allowed bg-surface-soft pr-9"
                value=""
                readOnly
                disabled
                tabIndex={-1}
                autoComplete="off"
                placeholder="Assigned on booking"
                aria-readonly="true"
              />
              <Lock className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
            </div>
          </Field>
          <div className="space-y-2">
            <Label>Payment</Label>
            <Select
              value={paymentStatus}
              onValueChange={(value) =>
                form.setValue("paymentStatus", value as FormValues["paymentStatus"])
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_STATUSES.filter((item) => item !== "FAILED" && item !== "PENDING" && item !== "REFUNDED").map((item) => (
                  <SelectItem key={item} value={item}>
                    {PAYMENT_STATUS_LABELS[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {paymentStatus === "PARTIAL" ? (
            <Field
              label="Amount already paid"
              hint="The rest is collected on delivery."
              error={form.formState.errors.amountPaid?.message}
            >
              <Input className="h-9" type="number" min={0} step="0.01" {...form.register("amountPaid")} />
            </Field>
          ) : null}
          {paymentStatus === "COD" || paymentStatus === "PARTIAL" ? (
            <p className="text-sm text-muted md:col-span-2">
              Collect on delivery: {formatCurrency(collectOnDelivery)}
              {orderTotal > 0 ? ` of ${formatCurrency(orderTotal)} total` : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <details
        ref={customerPanel}
        className="group rounded-2xl border border-border bg-card text-foreground shadow-[0_1px_2px_rgb(9_9_11/0.04),0_8px_24px_rgb(9_9_11/0.04)]"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 [&::-webkit-details-marker]:hidden">
          <div>
            <CardTitle>Create customer account</CardTitle>
            <p className="mt-0.5 text-xs text-muted">
              Optional. Skip this to use the shipping customer name and phone.
            </p>
          </div>
          <ChevronDown className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-3 px-4 pb-4 pt-0 md:grid-cols-3">
          <Field label="Name" hint="Optional." error={form.formState.errors.customerName?.message}>
            <Input className="h-9" autoComplete="name" {...form.register("customerName")} />
          </Field>
          <Field label="Phone" hint="Optional." error={form.formState.errors.customerPhone?.message}>
            <IndiaWhatsappField
              control={form.control}
              name="customerPhone"
              id="customerPhone"
              size="sm"
              hideLabel
              hideError
              error={form.formState.errors.customerPhone?.message}
              placeholder="10-digit mobile number"
            />
          </Field>
          <Field label="Email" hint="Optional." error={form.formState.errors.customerEmail?.message}>
            <Input
              className="h-9"
              type="email"
              autoComplete="email"
              placeholder="name@example.com (optional)"
              {...form.register("customerEmail")}
            />
          </Field>
        </div>
      </details>

      <Card>
        <CardHeader className="p-4">
          <CardTitle>Shipping address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-2">
          <AddressFields
            prefix="shippingAddress"
            form={{
              register: form.register,
              control: form.control,
              formState: form.formState,
              setValue: form.setValue,
            }}
          />
          <label className="col-span-full flex items-center gap-2 text-sm">
            <Checkbox
              checked={billingSame}
              onCheckedChange={(value) => form.setValue("billingSameAsShipping", value === true)}
            />
            Billing address is the same as shipping
          </label>
        </CardContent>
      </Card>

      {!billingSame ? (
        <Card>
          <CardHeader className="p-4">
            <CardTitle>Billing address</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-2">
            <AddressFields
              prefix="billingAddress"
              form={{
                register: form.register,
                control: form.control,
                formState: form.formState,
                setValue: form.setValue,
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between p-4">
          <div>
            <CardTitle>Line items</CardTitle>
            <p className="mt-0.5 text-xs text-muted">
              {items.fields.length} {items.fields.length === 1 ? "item" : "items"} · {totalQuantity} units
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div
            aria-hidden
            className={cn(
              "hidden px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted lg:grid lg:gap-2",
              LINE_ITEM_GRID
            )}
          >
            <span>Product</span>
            <span>SKU</span>
            <span className="text-center">Qty</span>
            <span>Unit price</span>
            <span>Weight</span>
            <span className="text-right">Total</span>
            <span />
          </div>

          <div className="space-y-2 lg:space-y-0 lg:divide-y lg:divide-border lg:rounded-xl lg:border lg:border-border">
            {items.fields.map((field, index) => {
              const titleError = form.formState.errors.lineItems?.[index]?.title?.message;
              const row = lineItemValues?.[index];
              const lineTotal = Number(row?.quantity || 0) * Number(row?.unitPrice || 0);
              return (
                <div
                  key={field.id}
                  className={cn(
                    "grid grid-cols-2 gap-x-2 gap-y-3 rounded-xl border border-border p-3 sm:grid-cols-4 lg:items-start lg:gap-y-0 lg:rounded-none lg:border-0 lg:px-3 lg:py-2.5",
                    LINE_ITEM_GRID
                  )}
                >
                  <div className="col-span-2 sm:col-span-4 lg:col-span-1">
                    <LineLabel htmlFor={`item-${field.id}-title`}>Product</LineLabel>
                    {catalogItems.length ? (
                      <Combobox
                        className="mb-1.5 h-9"
                        placeholder="Inventory product (optional)"
                        emptyText="No matching products"
                        options={[
                          { value: "", label: "Custom item" },
                          ...catalogItems.map((product) => ({
                            value: product.id,
                            label: `${product.name} · ${product.sku}`,
                          })),
                        ]}
                        value={row?.productId ?? ""}
                        onChange={(value) => applyCatalogProduct(index, value)}
                      />
                    ) : null}
                    <Input
                      id={`item-${field.id}-title`}
                      className="h-9"
                      placeholder="e.g. Cotton saree"
                      aria-invalid={Boolean(titleError)}
                      disabled={Boolean(row?.productId)}
                      {...form.register(`lineItems.${index}.title`)}
                    />
                    {titleError ? <p className="mt-1 text-xs text-error">{titleError}</p> : null}
                  </div>

                  <div>
                    <LineLabel htmlFor={`item-${field.id}-sku`}>SKU</LineLabel>
                    <Input
                      id={`item-${field.id}-sku`}
                      className="h-9"
                      placeholder="Optional"
                      disabled={Boolean(row?.productId)}
                      {...form.register(`lineItems.${index}.sku`)}
                    />
                  </div>

                  <div>
                    <LineLabel htmlFor={`item-${field.id}-qty`}>Qty</LineLabel>
                    <div className="flex h-9 items-stretch overflow-hidden rounded-[var(--radius-input)] border border-border bg-card shadow-sm focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
                      <button
                        type="button"
                        aria-label="Decrease quantity"
                        disabled={Number(row?.quantity || 1) <= 1}
                        onClick={() => stepQuantity(index, -1)}
                        className="flex w-8 shrink-0 items-center justify-center text-muted transition-colors hover:bg-surface-soft hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <input
                        id={`item-${field.id}-qty`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        className={cn(
                          "w-full min-w-0 bg-transparent text-center text-sm tabular-nums text-foreground outline-none",
                          NO_SPINNER
                        )}
                        {...form.register(`lineItems.${index}.quantity`)}
                      />
                      <button
                        type="button"
                        aria-label="Increase quantity"
                        onClick={() => stepQuantity(index, 1)}
                        className="flex w-8 shrink-0 items-center justify-center text-muted transition-colors hover:bg-surface-soft hover:text-foreground"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <LineLabel htmlFor={`item-${field.id}-price`}>Unit price</LineLabel>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
                      <Input
                        id={`item-${field.id}-price`}
                        className={cn("h-9 pl-7 tabular-nums", NO_SPINNER)}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        placeholder="0.00"
                        onFocus={(event) => event.currentTarget.select()}
                        disabled={Boolean(row?.productId)}
                        {...form.register(`lineItems.${index}.unitPrice`)}
                      />
                    </div>
                  </div>

                  <div>
                    <LineLabel htmlFor={`item-${field.id}-weight`}>Weight</LineLabel>
                    <div className="relative">
                      <Input
                        id={`item-${field.id}-weight`}
                        className={cn("h-9 pr-7 tabular-nums", NO_SPINNER)}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        placeholder="0"
                        onFocus={(event) => event.currentTarget.select()}
                        disabled={Boolean(row?.productId)}
                        {...form.register(`lineItems.${index}.weightGrams`)}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">g</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:col-span-3 lg:col-span-1 lg:h-9 lg:justify-end">
                    <span className="text-xs text-muted lg:hidden">Line total</span>
                    <span className="text-sm font-medium tabular-nums text-ink">{formatCurrency(lineTotal)}</span>
                  </div>

                  <div className="flex justify-end lg:h-9 lg:items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted hover:bg-error/10 hover:text-error"
                      disabled={items.fields.length === 1}
                      onClick={() => items.remove(index)}
                      aria-label={`Remove item ${index + 1}`}
                      title={items.fields.length === 1 ? "An order needs at least one item" : "Remove item"}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-center border border-dashed border-border text-muted hover:border-brand hover:text-brand sm:justify-start"
              onClick={addLineItem}
            >
              <Plus className="size-4" />
              Add another item
            </Button>
            <dl className="flex items-center justify-end gap-5 text-sm">
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted">Weight</dt>
                <dd className="tabular-nums">{formatWeight(totalWeight)}</dd>
              </div>
              <div className="flex items-baseline gap-1.5">
                <dt className="text-muted">Subtotal</dt>
                <dd className="font-semibold tabular-nums text-ink">{formatCurrency(orderTotal)}</dd>
              </div>
            </dl>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4">
          <CardTitle>Shipment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={createShipment}
              onCheckedChange={(value) => form.setValue("createShipment", value === true)}
            />
            Book with India Post
          </label>
          {createShipment ? <IndiaPostBookingGuide selectedService={selectedService} /> : null}
          {createShipment ? (
            <div className="space-y-3">
            <ShipmentPackPresets
              weightGrams={Number(shipmentWeight) || undefined}
              lengthCm={Number(shipmentLength) || undefined}
              widthCm={Number(shipmentWidth) || undefined}
              heightCm={Number(shipmentHeight) || undefined}
              serviceCode={selectedService}
              onApply={(pack) => {
                serviceTouched.current = true;
                form.setValue("shipment.weightGrams", pack.weightGrams, { shouldDirty: true });
                form.setValue("shipment.lengthCm", pack.lengthCm, { shouldDirty: true });
                form.setValue("shipment.widthCm", pack.widthCm, { shouldDirty: true });
                form.setValue("shipment.heightCm", pack.heightCm, { shouldDirty: true });
                form.setValue("shipment.serviceCode", pack.serviceCode, { shouldDirty: true });
              }}
            />
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Weight (g)" error={form.formState.errors.shipment?.weightGrams?.message}>
                <Input className="h-9" type="number" min={1} {...form.register("shipment.weightGrams")} />
              </Field>
              <Field label="Length (cm)" error={form.formState.errors.shipment?.lengthCm?.message}>
                <Input className="h-9" type="number" min={0} max={150} step="0.1" {...form.register("shipment.lengthCm")} />
              </Field>
              <Field label="Width (cm)" error={form.formState.errors.shipment?.widthCm?.message}>
                <Input className="h-9" type="number" min={0} max={150} step="0.1" {...form.register("shipment.widthCm")} />
              </Field>
              <Field label="Height (cm)" error={form.formState.errors.shipment?.heightCm?.message}>
                <Input className="h-9" type="number" min={0} max={150} step="0.1" {...form.register("shipment.heightCm")} />
              </Field>
              <Field
                label="Service"
                hint={
                  indiaPost.isPending
                    ? "Loading your India Post services…"
                    : indiaPost.isError
                      ? "Could not load India Post services."
                      : (indiaPost.data?.contracts ?? []).some((item) => item.contractId?.trim())
                        ? undefined
                        : "Add a contract on India Post settings to show your services."
                }
              >
                <Select
                  value={selectedService || undefined}
                  disabled={indiaPost.isPending || serviceOptions.length === 0}
                  onValueChange={(value) => {
                    serviceTouched.current = true;
                    form.setValue("shipment.serviceCode", value);
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Choose a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {serviceOptions.map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.label}
                        {item.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!indiaPost.isPending &&
                !(indiaPost.data?.contracts ?? []).some((item) => item.contractId?.trim()) ? (
                  <p className="mt-1 text-xs">
                    <Link href="/dashboard/integrations/india-post" className="text-brand underline-offset-2 hover:underline">
                      Open India Post settings
                    </Link>
                  </p>
                ) : null}
              </Field>
            </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      </div>

      <aside className="hidden xl:block">
        <div className="sticky top-4 space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-ink">Summary</h2>
          <p className="flex justify-between text-sm">
            <span className="text-muted">Items</span>
            <span>{lineItemValues?.length ?? 0}</span>
          </p>
          <p className="flex justify-between text-sm">
            <span className="text-muted">Total</span>
            <span className="font-medium tabular-nums">{formatCurrency(orderTotal)}</span>
          </p>
          {paymentStatus === "COD" || paymentStatus === "PARTIAL" ? (
            <p className="flex justify-between text-sm">
              <span className="text-muted">Collect</span>
              <span className="tabular-nums">{formatCurrency(collectOnDelivery)}</span>
            </p>
          ) : null}
        </div>
      </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur-sm xl:hidden">
        <Button type="submit" className="w-full" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Booking…" : "Book now"}
        </Button>
      </div>
    </form>
  );
}

const LINE_ITEM_GRID = "lg:grid-cols-[minmax(0,1fr)_6.5rem_7rem_7rem_5.5rem_5.5rem_2rem]";
const NO_SPINNER =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

function formatWeight(grams: number) {
  if (!grams) return "—";
  return grams >= 1000 ? `${(grams / 1000).toFixed(2).replace(/\.?0+$/, "")} kg` : `${grams} g`;
}

function listedIndianState(value: string) {
  const normalized = value.trim().toLowerCase();
  return INDIAN_STATES.find((state) => state.toLowerCase() === normalized) ?? value.trim();
}

function PincodeLookup({
  control,
  setValue,
  prefix,
}: {
  control: ReturnType<typeof useForm<FormValues>>["control"];
  setValue: ReturnType<typeof useForm<FormValues>>["setValue"];
  prefix: "shippingAddress" | "billingAddress";
}) {
  const value = useWatch({ control, name: `${prefix}.pincode` });
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
    if (city) setValue(`${prefix}.city`, city, { shouldDirty: true, shouldValidate: true });
    if (state) setValue(`${prefix}.state`, state, { shouldDirty: true, shouldValidate: true });
  }, [office, pincode, prefix, setValue]);

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

function LineLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted lg:sr-only">
      {children}
    </label>
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

function AddressFields({
  prefix,
  form,
}: {
  prefix: "shippingAddress" | "billingAddress";
  form: Pick<ReturnType<typeof useForm<FormValues>>, "register" | "control" | "formState" | "setValue">;
}) {
  const phoneError = form.formState.errors[prefix]?.phone?.message;
  return (
    <>
      <Field
        label={prefix === "billingAddress" ? "Name" : "Customer name"}
        error={form.formState.errors[prefix]?.name?.message}
      >
        <Input className="h-9" autoComplete="name" placeholder="Customer name" {...form.register(`${prefix}.name`)} />
      </Field>
      <Field label="Phone" error={phoneError}>
        <IndiaWhatsappField
          control={form.control}
          name={`${prefix}.phone`}
          id={`${prefix}-phone`}
          size="sm"
          hideLabel
          hideError
          error={phoneError}
          placeholder="10-digit mobile number"
        />
      </Field>
      <Field
        label="Address"
        className="md:col-span-2"
        hint="House, building, and street — required for booking."
        error={form.formState.errors[prefix]?.line1?.message}
      >
        <Input
          className="h-9"
          autoComplete="address-line1"
          placeholder="House / building, street"
          {...form.register(`${prefix}.line1`)}
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
          {...form.register(`${prefix}.line2`)}
        />
      </Field>
      <Field label="Pincode" error={form.formState.errors[prefix]?.pincode?.message}>
        <Input
          className="h-9 tabular-nums tracking-wide"
          inputMode="numeric"
          maxLength={6}
          autoComplete="postal-code"
          placeholder="6-digit pincode"
          {...form.register(`${prefix}.pincode`)}
        />
        <PincodeLookup control={form.control} setValue={form.setValue} prefix={prefix} />
      </Field>
      <Field label="City" error={form.formState.errors[prefix]?.city?.message}>
        <Input className="h-9" {...form.register(`${prefix}.city`)} />
      </Field>
      <Field label="State" error={form.formState.errors[prefix]?.state?.message}>
        <Controller
          control={form.control}
          name={`${prefix}.state`}
          defaultValue={DEFAULT_INDIAN_STATE}
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
        <input type="hidden" defaultValue="IN" {...form.register(`${prefix}.country`)} />
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
    </>
  );
}

"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/hooks/use-api";
import { formatCurrency } from "@/lib/format";
import { selectableIndiaPostServices } from "@/modules/india-post/contracts";
import { DEFAULT_INDIA_POST_SERVICE, PAYMENT_STATUSES, PAYMENT_STATUS_LABELS } from "@/types/domain";
import type { IndiaPostConfig } from "@/types/api";

const addressSchema = z.object({
  name: z.string().min(2, "Name is required."),
  phone: z.string().min(8, "Phone is required."),
  line1: z.string().min(3, "Address line 1 is required."),
  line2: z.string().optional(),
  city: z.string().min(2, "City is required."),
  state: z.string().min(2, "State is required."),
  pincode: z.string().regex(/^\d{6}$/, "Enter a 6-digit pincode."),
  country: z.string().min(2),
});

const schema = z.object({
  orderNumber: z.string().optional(),
  customerName: z.string().min(2, "Customer name is required."),
  customerPhone: z.string().min(8, "Phone is required."),
  customerEmail: z.union([z.email(), z.literal("")]).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  amountPaid: z.coerce.number().min(0).optional(),
  shippingAddress: addressSchema,
  billingSameAsShipping: z.boolean(),
  billingAddress: addressSchema.optional(),
  lineItems: z
    .array(
      z.object({
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
      weightGrams: z.coerce.number().int().min(1).optional(),
      lengthCm: z.coerce.number().min(0).optional(),
      widthCm: z.coerce.number().min(0).optional(),
      heightCm: z.coerce.number().min(0).optional(),
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
      paymentStatus: "PENDING",
      amountPaid: 0,
      billingSameAsShipping: true,
      shippingAddress: {
        name: "",
        phone: "",
        line1: "",
        line2: "",
        city: "",
        state: "",
        pincode: "",
        country: "IN",
      },
      lineItems: [{ title: "", sku: "", quantity: 1, unitPrice: 0, weightGrams: 0 }],
      createShipment: false,
      shipment: { serviceCode: DEFAULT_INDIA_POST_SERVICE, weightGrams: 0 },
    },
  });

  const serviceTouched = useRef(false);
  const items = useFieldArray({ control: form.control, name: "lineItems" });
  // React Hook Form watch() is incompatible with the compiler memoization pass.
  // eslint-disable-next-line react-hooks/incompatible-library -- form.watch subscription
  const billingSame = form.watch("billingSameAsShipping");
  const createShipment = form.watch("createShipment");
  const paymentStatus = form.watch("paymentStatus");
  const amountPaid = Number(form.watch("amountPaid") || 0);
  const lineItemValues = form.watch("lineItems");
  const selectedService = form.watch("shipment.serviceCode");
  const orderTotal = (lineItemValues ?? []).reduce(
    (sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0),
    0
  );
  const collectOnDelivery =
    paymentStatus === "COD"
      ? orderTotal
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

  async function onSubmit(values: FormValues) {
    try {
      const created = await api<{ id: string }>("/api/v1/orders", {
        method: "POST",
        body: JSON.stringify({
          orderNumber: values.orderNumber || undefined,
          customer: {
            name: values.customerName,
            phone: values.customerPhone,
            email: values.customerEmail || undefined,
          },
          shippingAddress: values.shippingAddress,
          billingSameAsShipping: values.billingSameAsShipping,
          billingAddress: values.billingSameAsShipping ? undefined : values.billingAddress,
          paymentStatus: values.paymentStatus,
          amountPaid: values.paymentStatus === "PARTIAL" ? Number(values.amountPaid || 0) : undefined,
          lineItems: values.lineItems,
          createShipment: values.createShipment,
          shipment: values.createShipment ? values.shipment : undefined,
        }),
      });
      toast.success("Order created.");
      router.push(`/dashboard/orders/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the order.");
    }
  }

  return (
    <form className="space-y-4 pb-20 xl:pb-0" onSubmit={form.handleSubmit(onSubmit)}>
      <PageHeader
        title="Add order"
        description="Create a manual order with customer, address, and line items."
        actions={
          <Button type="submit" size="sm" className="hidden xl:inline-flex" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save order"}
          </Button>
        }
      />

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_17rem] xl:items-start xl:gap-6">
      <div className="space-y-4">

      <Card>
        <CardHeader className="p-4">
          <CardTitle>Order</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-2">
          <Field label="Order number" hint="Leave blank to auto-generate">
            <Input className="h-9" {...form.register("orderNumber")} placeholder="PB-1042" />
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
                {PAYMENT_STATUSES.map((item) => (
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

      <Card>
        <CardHeader className="p-4">
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-3">
          <Field label="Name" error={form.formState.errors.customerName?.message}>
            <Input className="h-9" {...form.register("customerName")} />
          </Field>
          <Field label="Phone" error={form.formState.errors.customerPhone?.message}>
            <Input className="h-9" {...form.register("customerPhone")} />
          </Field>
          <Field label="Email">
            <Input className="h-9" type="email" {...form.register("customerEmail")} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4">
          <CardTitle>Shipping address</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 md:grid-cols-2">
          <AddressFields prefix="shippingAddress" form={{ register: form.register }} />
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
            <AddressFields prefix="billingAddress" form={{ register: form.register }} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex-row items-center justify-between p-4">
          <CardTitle>Line items</CardTitle>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => items.append({ title: "", sku: "", quantity: 1, unitPrice: 0, weightGrams: 0 })}
          >
            <Plus className="size-4" />
            Add item
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          {items.fields.map((field, index) => (
            <div key={field.id} className="grid gap-2 rounded-xl border border-border p-3 md:grid-cols-12">
              <Field label="Title" className="md:col-span-4">
                <Input className="h-9" {...form.register(`lineItems.${index}.title`)} />
              </Field>
              <Field label="SKU" className="md:col-span-2">
                <Input className="h-9" {...form.register(`lineItems.${index}.sku`)} />
              </Field>
              <Field label="Qty" className="md:col-span-2">
                <Input className="h-9" type="number" min={1} {...form.register(`lineItems.${index}.quantity`)} />
              </Field>
              <Field label="Unit price" className="md:col-span-2">
                <Input className="h-9" type="number" min={0} step="0.01" {...form.register(`lineItems.${index}.unitPrice`)} />
              </Field>
              <Field label="Weight (g)" className="md:col-span-1">
                <Input className="h-9" type="number" min={0} {...form.register(`lineItems.${index}.weightGrams`)} />
              </Field>
              <div className="flex items-end md:col-span-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={items.fields.length === 1}
                  onClick={() => items.remove(index)}
                  aria-label="Remove item"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
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
            Create shipment after save
          </label>
          {createShipment ? (
            <div className="grid gap-3 md:grid-cols-5">
              <Field label="Weight (g)">
                <Input className="h-9" type="number" min={1} {...form.register("shipment.weightGrams")} />
              </Field>
              <Field label="Length (cm)">
                <Input className="h-9" type="number" min={0} step="0.1" {...form.register("shipment.lengthCm")} />
              </Field>
              <Field label="Width (cm)">
                <Input className="h-9" type="number" min={0} step="0.1" {...form.register("shipment.widthCm")} />
              </Field>
              <Field label="Height (cm)">
                <Input className="h-9" type="number" min={0} step="0.1" {...form.register("shipment.heightCm")} />
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
          <Button type="submit" className="w-full" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Saving…" : "Save order"}
          </Button>
        </div>
      </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 p-3 backdrop-blur-sm xl:hidden">
        <Button type="submit" className="w-full" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : "Save order"}
        </Button>
      </div>
    </form>
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
  form: Pick<ReturnType<typeof useForm<FormValues>>, "register">;
}) {
  return (
    <>
      <Field label="Recipient">
        <Input className="h-9" {...form.register(`${prefix}.name`)} />
      </Field>
      <Field label="Phone">
        <Input className="h-9" {...form.register(`${prefix}.phone`)} />
      </Field>
      <Field label="Line 1" className="md:col-span-2">
        <Input className="h-9" {...form.register(`${prefix}.line1`)} />
      </Field>
      <Field label="Line 2" className="md:col-span-2">
        <Input className="h-9" {...form.register(`${prefix}.line2`)} />
      </Field>
      <Field label="City">
        <Input className="h-9" {...form.register(`${prefix}.city`)} />
      </Field>
      <Field label="State">
        <Input className="h-9" {...form.register(`${prefix}.state`)} />
      </Field>
      <Field label="Pincode">
        <Input className="h-9" {...form.register(`${prefix}.pincode`)} />
      </Field>
      <Field label="Country">
        <Input className="h-9" {...form.register(`${prefix}.country`)} />
      </Field>
    </>
  );
}

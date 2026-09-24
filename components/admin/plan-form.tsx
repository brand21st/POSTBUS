"use client";

import { useMemo, type ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  composePlanFeatures,
  ordersFeatureLine,
  PLAN_FEATURE_OPTIONS,
  splitPlanFeatures,
} from "@/modules/billing/plan-features";
import { yearlyPricePaise } from "@/modules/billing/prices";
import { cn } from "@/lib/utils";

export type PlanFormValue = {
  name: string;
  description: string;
  monthlyRupees: string;
  yearlyRupees: string;
  monthlyOrderLimit: string;
  displayOrder: string;
  selectedFeatures: string[];
  customFeatures: string;
};

export type AdminPlan = {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  monthlyPricePaise: number;
  yearlyPricePaise: number;
  monthlyOrderLimit: number;
  features: string[];
  isActive: boolean;
  displayOrder: number;
  subscriberCount: number;
};

const fieldInput = "h-9 px-3";

export function emptyPlanForm(): PlanFormValue {
  return {
    name: "",
    description: "",
    monthlyRupees: "",
    yearlyRupees: "",
    monthlyOrderLimit: "1000",
    displayOrder: "10",
    selectedFeatures: [],
    customFeatures: "",
  };
}

export function planToForm(plan: AdminPlan): PlanFormValue {
  const split = splitPlanFeatures(plan.features ?? [], plan.monthlyOrderLimit);
  return {
    name: plan.name,
    description: plan.description ?? "",
    monthlyRupees: String(plan.monthlyPricePaise / 100),
    yearlyRupees: String(plan.yearlyPricePaise / 100),
    monthlyOrderLimit: String(plan.monthlyOrderLimit),
    displayOrder: String(plan.displayOrder),
    selectedFeatures: [...split.selected],
    customFeatures: split.custom.join("\n"),
  };
}

export function formToPayload(form: PlanFormValue) {
  const monthlyPricePaise = Math.round(Number(form.monthlyRupees) * 100);
  const yearlyRaw = form.yearlyRupees.trim();
  const yearlyPricePaiseValue = yearlyRaw
    ? Math.round(Number(yearlyRaw) * 100)
    : yearlyPricePaise(monthlyPricePaise);
  const monthlyOrderLimit = Math.max(1, Math.trunc(Number(form.monthlyOrderLimit) || 1));
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    monthlyPricePaise,
    yearlyPricePaise: yearlyPricePaiseValue,
    monthlyOrderLimit,
    displayOrder: Number(form.displayOrder) || 99,
    features: composePlanFeatures(
      monthlyOrderLimit,
      form.selectedFeatures,
      form.customFeatures.split("\n")
    ),
  };
}

export function PlanEditorFields({
  form,
  onChange,
  idPrefix = "plan",
}: {
  form: PlanFormValue;
  onChange: (next: PlanFormValue) => void;
  idPrefix?: string;
}) {
  const orderLimit = Math.max(1, Math.trunc(Number(form.monthlyOrderLimit) || 1));
  const generated = useMemo(() => ordersFeatureLine(orderLimit), [orderLimit]);

  function toggleFeature(option: string, checked: boolean) {
    const selected = checked
      ? [...form.selectedFeatures, option]
      : form.selectedFeatures.filter((item) => item !== option);
    onChange({ ...form, selectedFeatures: selected });
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-6">
        <Field className="sm:col-span-3" htmlFor={`${idPrefix}-name`} label="Name">
          <Input
            id={`${idPrefix}-name`}
            className={fieldInput}
            value={form.name}
            onChange={(event) => onChange({ ...form, name: event.target.value })}
            placeholder="Pro"
          />
        </Field>
        <Field className="sm:col-span-2" htmlFor={`${idPrefix}-orders`} label="Orders / period">
          <Input
            id={`${idPrefix}-orders`}
            className={fieldInput}
            type="number"
            min={1}
            value={form.monthlyOrderLimit}
            onChange={(event) => onChange({ ...form, monthlyOrderLimit: event.target.value })}
          />
        </Field>
        <Field className="sm:col-span-1" htmlFor={`${idPrefix}-order`} label="Sort">
          <Input
            id={`${idPrefix}-order`}
            className={fieldInput}
            type="number"
            value={form.displayOrder}
            onChange={(event) => onChange({ ...form, displayOrder: event.target.value })}
          />
        </Field>
        <Field className="sm:col-span-6" htmlFor={`${idPrefix}-description`} label="Description">
          <Textarea
            id={`${idPrefix}-description`}
            value={form.description}
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            className="min-h-[64px] px-3 py-2"
            rows={2}
            placeholder="Who this plan is for"
          />
        </Field>
        <Field className="sm:col-span-3" htmlFor={`${idPrefix}-monthly`} label="Monthly (₹)">
          <Input
            id={`${idPrefix}-monthly`}
            className={fieldInput}
            type="number"
            min={0}
            step="1"
            value={form.monthlyRupees}
            onChange={(event) => onChange({ ...form, monthlyRupees: event.target.value })}
          />
        </Field>
        <Field
          className="sm:col-span-3"
          htmlFor={`${idPrefix}-yearly`}
          label="Yearly (₹)"
          hint="Blank uses 20% off 12 months"
        >
          <Input
            id={`${idPrefix}-yearly`}
            className={fieldInput}
            type="number"
            min={0}
            step="1"
            value={form.yearlyRupees}
            onChange={(event) => onChange({ ...form, yearlyRupees: event.target.value })}
            placeholder="Auto"
          />
        </Field>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Label>Features</Label>
          <p className="text-xs text-muted">Always included: {generated}</p>
        </div>
        <div className="grid max-h-[220px] gap-1 overflow-y-auto rounded-xl border border-border bg-surface-soft/40 p-1.5 sm:grid-cols-2">
          {PLAN_FEATURE_OPTIONS.map((option) => {
            const checked = form.selectedFeatures.includes(option);
            return (
              <label
                key={option}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-[13px] leading-snug text-ink hover:bg-card",
                  checked && "bg-card shadow-sm"
                )}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={checked}
                  onCheckedChange={(value) => toggleFeature(option, value === true)}
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
        <Field htmlFor={`${idPrefix}-custom`} label="Custom lines" hint="One per line">
          <Textarea
            id={`${idPrefix}-custom`}
            value={form.customFeatures}
            onChange={(event) => onChange({ ...form, customFeatures: event.target.value })}
            className="min-h-[56px] px-3 py-2"
            rows={2}
            placeholder="Dedicated account manager"
          />
        </Field>
      </section>
    </div>
  );
}

function Field({
  htmlFor,
  label,
  hint,
  className,
  children,
}: {
  htmlFor: string;
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={htmlFor} className="text-xs">
          {label}
        </Label>
        {hint ? <span className="text-[11px] text-muted">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

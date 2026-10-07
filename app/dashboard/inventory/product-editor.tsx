"use client";

import { Controller, type UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { discountPercent } from "@/modules/storefront/pricing";

export type ProductFormCategory = { id: string; name: string; active: boolean };
export type ProductPick = { id: string; name: string; sku: string };

function FieldError({ message }: { message?: unknown }) {
  return message ? <p className="mt-1 text-xs text-error">{String(message)}</p> : null;
}

export function ProductEditorFields({
  form,
  showOpening,
  categories,
  catalog,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  showOpening: boolean;
  categories: ProductFormCategory[];
  catalog: ProductPick[];
}) {
  const price = Number(form.watch("price") || 0);
  const compare = Number(form.watch("compareAtPrice") || 0);
  const off = discountPercent(price, compare);
  const prepaid = form.watch("prepaidEnabled");
  const cod = form.watch("codEnabled");

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Product information</h3>
        <div>
          <Label htmlFor="product-name">Product name</Label>
          <Input id="product-name" className="mt-1 h-11" {...form.register("name")} />
          <FieldError message={form.formState.errors.name?.message} />
        </div>
        <div>
          <Label htmlFor="product-sku">SKU</Label>
          <Input id="product-sku" className="mt-1 h-11" {...form.register("sku")} />
          <FieldError message={form.formState.errors.sku?.message} />
        </div>
        {categories.length ? (
          <fieldset>
            <legend className="text-sm font-medium">Category</legend>
            <Controller
              control={form.control}
              name="categoryIds"
              render={({ field }) => (
                <div className="mt-2 flex flex-wrap gap-2">
                  {categories
                    .filter((category) => category.active)
                    .map((category) => {
                      const selected = ((field.value as string[] | undefined) ?? []).includes(category.id);
                      return (
                        <label
                          key={category.id}
                          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-3 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => {
                              const current = new Set((field.value as string[] | undefined) ?? []);
                              if (event.target.checked) current.add(category.id);
                              else current.delete(category.id);
                              field.onChange([...current]);
                            }}
                          />
                          {category.name}
                        </label>
                      );
                    })}
                </div>
              )}
            />
          </fieldset>
        ) : null}
        <div>
          <Label htmlFor="product-description">Description</Label>
          <Textarea id="product-description" className="mt-1 min-h-[96px]" {...form.register("description")} />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Pricing</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="product-price">Selling price</Label>
            <Input id="product-price" className="mt-1 h-11" type="number" min={0} step="0.01" {...form.register("price")} />
          </div>
          <div>
            <Label htmlFor="product-compare">Compare-at price</Label>
            <Input
              id="product-compare"
              className="mt-1 h-11"
              type="number"
              min={0}
              step="0.01"
              {...form.register("compareAtPrice")}
            />
          </div>
        </div>
        {off ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
            {formatCurrency(price)} <span className="text-emerald-700/70 line-through">{formatCurrency(compare)}</span> · {off}% OFF
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Inventory</h3>
        <div className="grid grid-cols-2 gap-3">
          {showOpening ? (
            <div>
              <Label htmlFor="product-opening">Opening stock</Label>
              <Input id="product-opening" className="mt-1 h-11" type="number" min={0} {...form.register("openingStock")} />
            </div>
          ) : null}
          <div>
            <Label htmlFor="product-weight">Weight (g)</Label>
            <Input id="product-weight" className="mt-1 h-11" type="number" min={0} {...form.register("weightGrams")} />
          </div>
          <div>
            <Label htmlFor="product-threshold">Low stock threshold</Label>
            <Input
              id="product-threshold"
              className="mt-1 h-11"
              type="number"
              min={0}
              {...form.register("lowStockThreshold")}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Store</h3>
        <ToggleRow control={form.control} name="storeVisible" label="Show in store" />
        <ToggleRow control={form.control} name="returnAvailable" label="Return available" />
        <ToggleRow control={form.control} name="featured" label="Featured product" />
        {!showOpening ? <ToggleRow control={form.control} name="active" label="Active" /> : null}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-ink">Payment</h3>
        <ToggleRow control={form.control} name="prepaidEnabled" label="Prepaid" />
        <ToggleRow control={form.control} name="codEnabled" label="Cash on delivery" />
        {cod ? (
          <div>
            <Label htmlFor="cod-advance">COD advance default %</Label>
            <Input
              id="cod-advance"
              className="mt-1 h-11"
              type="number"
              min={0}
              max={100}
              step="0.01"
              {...form.register("codAdvancePercent")}
            />
            <p className="mt-1 text-xs text-muted">Customers see rupee amounts, not this percentage.</p>
          </div>
        ) : null}
        {!prepaid && !cod ? <p className="text-xs text-error">Enable prepaid, COD, or both.</p> : null}
      </section>

      {catalog.length ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Recommendations</h3>
          <ProductIdPicker
            control={form.control}
            name="upsellProductIds"
            label="Upsell products"
            catalog={catalog}
          />
          <ProductIdPicker
            control={form.control}
            name="crossSellProductIds"
            label="Cross-sell products"
            catalog={catalog}
          />
        </section>
      ) : null}
    </div>
  );
}

function ToggleRow({
  control,
  name,
  label,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  name: string;
  label: string;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between rounded-xl border border-border px-3">
      <Label htmlFor={name}>{label}</Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Switch id={name} checked={Boolean(field.value)} onCheckedChange={field.onChange} />
        )}
      />
    </div>
  );
}

function ProductIdPicker({
  control,
  name,
  label,
  catalog,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: any;
  name: string;
  label: string;
  catalog: ProductPick[];
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{label}</legend>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
            {catalog.map((product) => {
              const selected = ((field.value as string[] | undefined) ?? []).includes(product.id);
              return (
                <label key={product.id} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-soft">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => {
                      const current = new Set((field.value as string[] | undefined) ?? []);
                      if (event.target.checked) current.add(product.id);
                      else current.delete(product.id);
                      field.onChange([...current].slice(0, 8));
                    }}
                  />
                  <span className="truncate">{product.name}</span>
                  <span className="ml-auto text-xs text-muted">{product.sku}</span>
                </label>
              );
            })}
          </div>
        )}
      />
    </fieldset>
  );
}

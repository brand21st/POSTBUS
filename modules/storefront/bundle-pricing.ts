import { z } from "zod";

export const bundleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  pricingMode: z.enum(["FIXED", "PERCENT"]),
  priceValue: z.number().positive().max(10_000_000),
  published: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(2).max(8),
}).superRefine((value, ctx) => {
  if (new Set(value.items.map((item) => item.productId)).size !== value.items.length) ctx.addIssue({ code: "custom", path: ["items"], message: "Choose distinct products." });
  if (value.pricingMode === "PERCENT" && value.priceValue >= 100) ctx.addIssue({ code: "custom", path: ["priceValue"], message: "Discount must be below 100%." });
});
export const bundleSelectionSchema = z.array(z.object({ bundleId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).max(20).default([]);
export type BundleInput = z.infer<typeof bundleInputSchema>;
export type BundleSelection = z.infer<typeof bundleSelectionSchema>[number];

// Largest-remainder allocation keeps components and the bundle total in integer paise.
export function allocateBundlePrices(lines: Array<{ productId: string; price: number; quantity: number }>, mode: "FIXED" | "PERCENT", value: number) {
  const weights = lines.map((line) => Math.round(line.price * 100) * line.quantity);
  const subtotal = weights.reduce((sum, n) => sum + n, 0);
  const total = mode === "FIXED" ? Math.round(value * 100) : Math.round(subtotal * (1 - value / 100));
  if (!Number.isSafeInteger(total) || total <= 0 || total > subtotal || subtotal <= 0) throw new Error("Bundle price must be positive and no greater than its products' total.");
  const shares = weights.map((weight, index) => ({ index, amount: Math.floor(total * weight / subtotal), remainder: (total * weight) % subtotal }));
  let remaining = total - shares.reduce((sum, share) => sum + share.amount, 0);
  for (const share of [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining-- <= 0) break;
    share.amount++;
  }
  return { total: total / 100, subtotal: subtotal / 100, savings: (subtotal - total) / 100, lines: shares.flatMap(({ index, amount }) => {
    const line = lines[index];
    const unit = Math.floor(amount / line.quantity);
    const extra = amount % line.quantity;
    return [
      ...(line.quantity > extra ? [{ productId: line.productId, quantity: line.quantity - extra, unitPrice: unit / 100 }] : []),
      ...(extra ? [{ productId: line.productId, quantity: extra, unitPrice: (unit + 1) / 100 }] : []),
    ];
  }) };
}

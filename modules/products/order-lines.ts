import { AppError, ERROR_CODES } from "@/lib/api/errors";
import { roundMoney, settleOrderPayment, type SettledOrderPayment } from "@/modules/orders/payment";
import { productCoverImageUrl } from "@/modules/products/images";
import { catalogCodAdvancePaid } from "@/modules/products/payment";
import type { PaymentStatus } from "@/types/domain";

export type ResolvedOrderLine = {
  productId: string | null;
  title: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  weightGrams: number | null;
  prepaidEnabled: boolean | null;
  codEnabled: boolean | null;
  codAdvancePercent: number | null;
  imageUrl: string | null;
};

type CatalogRow = {
  id: string;
  name: string;
  sku: string;
  price: number | string;
  weight_grams: number;
  active: boolean;
  prepaid_enabled: boolean;
  cod_enabled: boolean;
  cod_advance_percent: number | string | null;
  image_urls?: unknown;
};

type LineInput = {
  productId?: string;
  title?: string;
  sku?: string;
  quantity: number;
  unitPrice?: number;
  weightGrams?: number;
};

function money(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (amount == null || Number.isNaN(amount)) return 0;
  return roundMoney(amount);
}

export function assertCatalogPayment(
  lines: ResolvedOrderLine[],
  paymentStatus: PaymentStatus | undefined
) {
  const catalog = lines.filter((line) => line.productId);
  if (!catalog.length || !paymentStatus) return;

  if (paymentStatus === "PAID") {
    const blocked = catalog.find((line) => line.prepaidEnabled === false);
    if (blocked) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        `${blocked.title} does not support prepaid orders.`
      );
    }
  }

  if (paymentStatus === "COD" || paymentStatus === "PARTIAL") {
    const blocked = catalog.find((line) => line.codEnabled === false);
    if (blocked) {
      throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${blocked.title} does not support COD orders.`);
    }
  }
}

export function settleResolvedOrderPayment(input: {
  lines: ResolvedOrderLine[];
  paymentStatus?: PaymentStatus | null;
  amountPaid?: number | null;
}): SettledOrderPayment {
  const total = roundMoney(input.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
  const status = input.paymentStatus ?? "PENDING";
  const catalogLines = input.lines.filter((line) => line.productId);
  const allCatalog = catalogLines.length > 0 && catalogLines.length === input.lines.length;

  assertCatalogPayment(input.lines, status);

  if (status === "COD" && allCatalog && (input.amountPaid == null || Number.isNaN(Number(input.amountPaid)))) {
    const paid = catalogCodAdvancePaid(
      catalogLines.map((line) => ({
        unitPrice: line.unitPrice,
        quantity: line.quantity,
        product: {
          prepaidEnabled: Boolean(line.prepaidEnabled),
          codEnabled: Boolean(line.codEnabled),
          codAdvancePercent: line.codAdvancePercent,
        },
      }))
    );
    if (paid <= 0) return settleOrderPayment({ paymentStatus: "COD", totalAmount: total });
    if (paid >= total && total > 0) {
      return settleOrderPayment({ paymentStatus: "PAID", totalAmount: total });
    }
    return settleOrderPayment({
      paymentStatus: "PARTIAL",
      totalAmount: total,
      amountPaid: paid,
    });
  }

  return settleOrderPayment({
    paymentStatus: status,
    totalAmount: total,
    amountPaid: input.amountPaid,
  });
}

export function resolveLineFromCatalog(product: CatalogRow, quantity: number): ResolvedOrderLine {
  if (!product.active) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, `${product.name} is not active.`);
  }
  return {
    productId: product.id,
    title: product.name,
    sku: product.sku,
    quantity,
    unitPrice: money(product.price),
    weightGrams: product.weight_grams,
    prepaidEnabled: product.prepaid_enabled,
    codEnabled: product.cod_enabled,
    codAdvancePercent: money(product.cod_advance_percent),
    imageUrl: productCoverImageUrl(product.image_urls),
  };
}

export function resolveManualLine(input: LineInput): ResolvedOrderLine {
  const title = input.title?.trim() ?? "";
  if (!title) {
    throw new AppError(ERROR_CODES.VALIDATION_ERROR, "Item title is required.");
  }
  return {
    productId: null,
    title,
    sku: input.sku?.trim() || null,
    quantity: input.quantity,
    unitPrice: money(input.unitPrice),
    weightGrams: input.weightGrams ?? null,
    prepaidEnabled: null,
    codEnabled: null,
    codAdvancePercent: null,
    imageUrl: null,
  };
}

export function mapCatalogRows(rows: CatalogRow[] | null | undefined) {
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

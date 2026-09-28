import type { AddressParts } from "@/modules/labels/address-layout";
import type { CustomLabelPreview } from "@/modules/labels/custom-blocks";
import { SAMPLE_PACKING_DATA } from "@/modules/labels/packing-data";
import type { PackingLabelData } from "@/modules/labels/packing-pdf";

function party(parts: AddressParts | undefined, fallbackName = ""): PackingLabelData["receiver"] {
  const cityLine = [parts?.city, parts?.state].filter(Boolean).join(", ");
  return {
    name: parts?.name || fallbackName,
    phone: parts?.mobile || "",
    lines: [parts?.street, cityLine, parts?.pincode].filter((line): line is string => Boolean(line)),
    street: parts?.street,
    city: parts?.city,
    district: parts?.district,
    state: parts?.state,
    pincode: parts?.pincode,
    country: parts?.country,
    altMobile: parts?.altMobile,
    email: parts?.email,
  };
}

export function packingForEditor(preview: CustomLabelPreview | null, payment: "COD" | "PREPAID"): PackingLabelData {
  const base: PackingLabelData = preview
    ? {
        ...SAMPLE_PACKING_DATA,
        orderNumber: preview.orderNumber,
        orderDate: preview.orderDate,
        items: preview.items,
        total: preview.total,
        codAmount: preview.codAmount,
        articleId: preview.articleId,
        articleType: preview.articleType,
        contractId: preview.contractId,
        customerId: preview.customerId,
        weightGrams: preview.weightGrams,
        lengthCm: preview.lengthCm,
        widthCm: preview.widthCm,
        heightCm: preview.heightCm,
        logoUrl: preview.logoUrl,
        receiver: party(preview.shipParts),
        sender: party(preview.fromParts, SAMPLE_PACKING_DATA.sender.name),
        storeName: preview.fromParts?.name || SAMPLE_PACKING_DATA.storeName,
        storePhone: preview.fromParts?.mobile || SAMPLE_PACKING_DATA.storePhone,
      }
    : SAMPLE_PACKING_DATA;
  return { ...base, paymentMode: payment, paymentMethod: payment };
}

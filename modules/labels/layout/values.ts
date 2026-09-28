import {
  articleContractLine,
  codAmountLines,
  customerIdLine,
  isCustomTextId,
  orderIdDateLines,
  parcelSizeLines,
  serviceContractLine,
} from "@/modules/labels/custom-blocks";
import type { PackingLabelData } from "@/modules/labels/packing-pdf";
import type { TemplateElement } from "@/modules/labels/template-schema";

function money(value: number) {
  const amount = Number.isFinite(value) ? value : 0;
  return `Rs ${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function blockText(id: string, data: PackingLabelData, element?: TemplateElement) {
  if (isCustomTextId(id)) return element?.content?.trim() || "";
  switch (id) {
    case "receiverName":
      return data.receiver.name ? `TO: ${data.receiver.name}` : "";
    case "receiverAddress":
      return data.receiver.lines.join(", ");
    case "receiverPhone":
      return data.receiver.phone ? `Ph: ${data.receiver.phone}` : "";
    case "senderName":
      return data.sender.name ? `FROM: ${data.sender.name}` : "";
    case "senderAddress":
      return data.sender.lines.join(", ");
    case "senderPhone":
      return data.sender.phone ? `Ph: ${data.sender.phone}` : "";
    case "storeName":
      return data.storeName;
    case "storePhone":
      return data.storePhone ? `Phone ${data.storePhone}` : "";
    case "storeWebsite":
      return data.storeWebsite;
    case "orderNumber":
      return data.orderNumber ? `Order ${data.orderNumber}` : "";
    case "shopifyOrderNumber":
      return data.shopifyOrderNumber ? `Shopify ${data.shopifyOrderNumber}` : "";
    case "subtotal":
      return `Subtotal  ${money(data.subtotal)}`;
    case "shipping":
      return `Shipping  ${money(data.shipping)}`;
    case "discount":
      return `Discount  ${money(data.discount)}`;
    case "total":
      return `Price  ${money(data.total)}`;
    case "codAmount":
      return codAmountLines(data.codAmount).join("\n");
    case "paymentMethod":
      return data.paymentMethod ? `Payment  ${data.paymentMethod}` : "";
    case "customerNote":
      return data.customerNote ? `Note  ${data.customerNote}` : "";
    case "promotionalMessage":
      return element?.content?.trim() || "";
    case "returnAddress":
      return data.returnAddress ? `Return to  ${data.returnAddress}` : "";
    case "returnPolicy":
      return element?.content?.trim() || "";
    case "customerSupport":
      return element?.content?.trim() || (data.storePhone ? `Support  ${data.storePhone}` : "");
    case "customerId":
      return customerIdLine(data.customerId);
    case "articleType":
      return articleContractLine(data.articleType, data.contractId);
    case "serviceContractId":
      return serviceContractLine(data.contractId);
    case "orderIdDate":
      return orderIdDateLines(data.orderNumber, data.orderDate).join("\n");
    case "parcelSize":
      return parcelSizeLines(data, true).join("\n");
    case "prepaid":
      return "PRE PAID";
    default:
      return "";
  }
}

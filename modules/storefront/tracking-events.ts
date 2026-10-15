export type CommerceEventName = "page_view" | "view_item_list" | "select_item" | "view_item" | "add_to_cart" | "remove_from_cart" | "view_cart" | "begin_checkout" | "add_bundle" | "purchase";
export type CommerceItem = { item_id: string; item_name: string; price: number; quantity: number };
export type CommerceEvent = { name: CommerceEventName; eventId: string; currency: "INR"; value?: number; transactionId?: string; items?: CommerceItem[] };
export function commerceEvent(name: CommerceEventName, input: { eventId?: string; value?: number; transactionId?: string; items?: CommerceItem[] } = {}): CommerceEvent {
  return { name, eventId: input.eventId ?? crypto.randomUUID(), currency: "INR",
    ...(Number.isFinite(input.value) ? { value: Math.max(0, Math.round(input.value! * 100) / 100) } : {}),
    ...(input.transactionId ? { transactionId: input.transactionId.slice(0, 100) } : {}),
    ...(input.items ? { items: input.items.slice(0, 100).map((item) => ({ item_id: item.item_id.slice(0, 100), item_name: item.item_name.slice(0, 160), price: Math.max(0, Number(item.price) || 0), quantity: Math.max(1, Math.floor(item.quantity) || 1) })) } : {}),
  };
}
export function emitStoreEvent(workspace: string, event: CommerceEvent) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("postbus:commerce", { detail: { workspace, event } }));
}

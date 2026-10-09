/**
 * Vachat surfaces used by Support Center.
 * Verified = called from PostBus today. Unverified = not implemented; do not invent URLs.
 */
export const VACHAT_SUPPORT_CONTRACT = {
  verified: {
    webhookEvents: ["message.received", "message.status_updated"],
    webhookSignature: "X-Wacrm-Signature t=,v1=",
    inboundFields: ["conversation_id", "contact_id", "message_id", "whatsapp_message_id", "content_type", "text"],
    sessionSend: "POST /api/v1/messages",
    templateSend: "POST /api/v1/messages type=template",
    templateCatalog: "GET /api/postbus/templates",
    contactLookup: "GET /api/v1/contacts/{id}",
    merchantIdOnStatus: "data.merchant_id",
  },
  unverified: {
    mediaDownload: "No download URL or binary fetch exists in this repo.",
    historyBackfill: "No conversation history API is called from PostBus.",
    phoneNumberId: "GET /api/v1/me is probed but WABA / phone-number id is not parsed.",
    merchantInboundAccountId: "message.received tenant id is used only when merchant_id is present.",
  },
} as const;

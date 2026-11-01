/**
 * India Post does not document HMAC, mTLS, or fixed webhook egress IPs.
 * Ingest stays quarantined until a verified sender authenticator exists.
 * Do not treat X-Forwarded-For as the client address.
 */
export function webhookSourceIp(headers: Headers) {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return headers.get("x-real-ip")?.trim() || null;
}

/** HTTP handlers acknowledge CEPT POSTs but must not persist or mutate shipments. */
export function isIndiaPostWebhookQuarantined() {
  return true;
}

import { timingSafeEqual } from "crypto";
import { bookingProofKeyId, bookingProofSecrets, hmacSha256Digest } from "@/lib/security/crypto";
import { shipmentBarcode } from "@/modules/india-post/booking-idempotency";
import { readCeptSubmitIntentAt } from "@/modules/india-post/booking-intent";

/** Server-signed proof that this process stored the barcode on a new shipment. */
export const BOOKING_BARCODE_PROOF = "bookingBarcodeProof";
const PROOF_VERSION = 1;
const PROOF_DOMAIN = "postbus.booking-barcode-proof.v1";

/** A proof issued long after the row was created cannot authorize an old barcode. */
const PROOF_WINDOW_MS = 5 * 60 * 1000;

type BarcodeProof = {
  v: number;
  barcode: string;
  issuedAt: string;
  keyId: string;
  signature: string;
};

function proofPayload(input: { shipmentId: string; organizationId: string; barcode: string; issuedAt: string }) {
  const fields = [PROOF_DOMAIN, input.shipmentId, input.organizationId, input.barcode, input.issuedAt];
  return fields.map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`).join("\n");
}

function macMatches(expected: Buffer, presented: string) {
  if (!/^[0-9a-f]{64}$/i.test(presented)) return false;
  const actual = Buffer.from(presented, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}

export function signFirstBarcodeProof(input: {
  shipmentId: string;
  organizationId: string;
  barcode: string;
  issuedAt: string;
}) {
  const secret = bookingProofSecrets()[0];
  if (!secret) return "";
  return hmacSha256Digest(proofPayload({ ...input, barcode: shipmentBarcode(input.barcode) }), secret).toString("hex");
}

function metadataRecord(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  return { ...(metadata as Record<string, unknown>) };
}

function readBarcodeProof(metadata: unknown): BarcodeProof | null {
  const raw = metadataRecord(metadata)[BOOKING_BARCODE_PROOF];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const proof = raw as Record<string, unknown>;
  const barcode = shipmentBarcode(typeof proof.barcode === "string" ? proof.barcode : null);
  const issuedAt = typeof proof.issuedAt === "string" ? proof.issuedAt.trim() : "";
  const signature = typeof proof.signature === "string" ? proof.signature.trim() : "";
  const keyId = typeof proof.keyId === "string" ? proof.keyId.trim() : "";
  if (proof.v !== PROOF_VERSION || !barcode || !issuedAt || !signature || !keyId) return null;
  return { v: PROOF_VERSION, barcode, issuedAt, keyId, signature };
}

/** Metadata for a shipment insert. Merchants cannot produce a valid signature. */
export function metadataWithFirstBarcodeProof(
  metadata: unknown,
  input: { shipmentId: string; organizationId: string; barcode: string; issuedAt: string }
) {
  const barcode = shipmentBarcode(input.barcode);
  const issuedAt = input.issuedAt.trim();
  const secret = bookingProofSecrets()[0];
  return {
    ...metadataRecord(metadata),
    [BOOKING_BARCODE_PROOF]: {
      v: PROOF_VERSION,
      barcode,
      issuedAt,
      keyId: secret ? bookingProofKeyId(secret) : "",
      signature: signFirstBarcodeProof({ ...input, barcode, issuedAt }),
    },
  };
}

type ProvenanceShipment = {
  id?: string | null;
  organization_id?: string | null;
  organizationId?: string | null;
  barcode?: string | null;
  booked_at?: string | null;
  bookedAt?: string | null;
  tracking_number?: string | null;
  trackingNumber?: string | null;
  provider_ref?: string | null;
  providerRef?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  metadata?: unknown;
};

/**
 * True only for a server-signed barcode written when this shipment row was created.
 * Submit intent, a booking reference, or a signature that does not match the row rejects it.
 */
export function trustedFirstBarcodeProof(shipment: ProvenanceShipment) {
  if (readCeptSubmitIntentAt(shipment.metadata)) return false;
  if (shipment.bookedAt ?? shipment.booked_at) return false;
  if (shipmentBarcode(shipment.trackingNumber ?? shipment.tracking_number)) return false;
  if (String(shipment.providerRef ?? shipment.provider_ref ?? "").trim()) return false;
  const barcode = shipmentBarcode(shipment.barcode);
  const shipmentId = String(shipment.id ?? "");
  const organizationId = String(shipment.organizationId ?? shipment.organization_id ?? "");
  const proof = readBarcodeProof(shipment.metadata);
  if (!barcode || !shipmentId || !organizationId || !proof || proof.barcode !== barcode) return false;
  const payload = proofPayload({ shipmentId, organizationId, barcode, issuedAt: proof.issuedAt });
  const secret = bookingProofSecrets().find((item) => bookingProofKeyId(item) === proof.keyId);
  if (!secret || !macMatches(hmacSha256Digest(payload, secret), proof.signature)) return false;
  const createdMs = Date.parse(String(shipment.createdAt ?? shipment.created_at ?? ""));
  const issuedMs = Date.parse(proof.issuedAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(issuedMs)) return false;
  return Math.abs(createdMs - issuedMs) <= PROOF_WINDOW_MS;
}

export function duplicateBarcodeBookingBlock(existing: { id?: string | null } | null | undefined) {
  if (!existing?.id) return null;
  return "This barcode is already assigned to a shipment. It was not booked again.";
}

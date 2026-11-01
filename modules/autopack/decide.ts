import { parcelBoxIssue } from "@/modules/india-post/article-validator";
import {
  manualDimensionLock,
  readParcelDimensionRecord,
  type CmBox,
  type PackageOption,
  type ResolvedShipmentDimensions,
} from "@/modules/shopify/dimensions";
import type { ShipmentComposition } from "@/modules/autopack/composition";

/**
 * AutoPack package decision. Pure and deterministic.
 * Every box it returns is copied from evidence: a packaging_history row, a saved
 * pack size, a Shopify measurement or the workspace default. Nothing is estimated.
 */

export type EvidenceLevel = "entered" | "confirmed" | "verified";

export type PackagingHistoryRow = {
  id: string;
  compositionKey: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  serviceCode: string;
  packageSource: "preset" | "custom";
  presetId: string | null;
  evidenceLevel: EvidenceLevel;
  createdAt: string;
  supersededAt: string | null;
};

export type DecisionEvidence =
  | { type: "history"; historyId: string; level: EvidenceLevel }
  | { type: "preset" }
  | { type: "shopify" }
  | { type: "default" };

export type ReviewReason =
  | "MISSING_VARIANT_IDS"
  | "EMPTY_SHIPMENT"
  | "NO_HISTORY"
  | "UNCONFIRMED_HISTORY"
  | "CONFLICTING_HISTORY"
  | "INVALID_FOR_SERVICE"
  | "REJECTED_BY_MERCHANT";

export type PackageDecision =
  | { kind: "KEEP_EXISTING"; reason: "MERCHANT_OVERRIDE" | "SHIPMENT_LOCKED" | "ALREADY_APPLIED" }
  | {
      kind: "SAVED_PACKAGE";
      presetId: string;
      presetName: string;
      box: CmBox;
      evidence: DecisionEvidence;
      autoApplicable: boolean;
      reason: string;
    }
  | {
      kind: "CUSTOM_DIMENSIONS";
      box: CmBox;
      evidence: DecisionEvidence;
      autoApplicable: boolean;
      reason: string;
    }
  | { kind: "MANUAL_REVIEW_REQUIRED"; reason: ReviewReason; message: string };

export type DecisionShipment = {
  status?: string | null;
  bookedAt?: string | null;
  barcode?: string | null;
  metadata?: unknown;
};

/** Shipments AutoPack may write to. Anything past DRAFT/FAILED belongs to the booking pipeline. */
export const AUTOPACK_WRITABLE_STATUSES = ["DRAFT", "FAILED"] as const;

export function autopackShipmentWritable(shipment: DecisionShipment | null | undefined) {
  if (!shipment) return true;
  const status = String(shipment.status ?? "").toUpperCase();
  return (
    (AUTOPACK_WRITABLE_STATUSES as readonly string[]).includes(status) &&
    !shipment.bookedAt &&
    !String(shipment.barcode ?? "").trim()
  );
}

function roundBox(box: CmBox): CmBox {
  const round = (value: number) => Math.round(Number(value) * 10) / 10;
  return { lengthCm: round(box.lengthCm), widthCm: round(box.widthCm), heightCm: round(box.heightCm) };
}

export function sameBox(left: CmBox, right: CmBox) {
  const a = roundBox(left);
  const b = roundBox(right);
  return a.lengthCm === b.lengthCm && a.widthCm === b.widthCm && a.heightCm === b.heightCm;
}

function boxOf(row: CmBox): CmBox {
  return roundBox({ lengthCm: row.lengthCm, widthCm: row.widthCm, heightCm: row.heightCm });
}

function describe(box: CmBox) {
  return `${box.lengthCm} × ${box.widthCm} × ${box.heightCm} cm`;
}

function fromFallback(fallback: ResolvedShipmentDimensions): PackageDecision {
  const box = boxOf(fallback);
  if (fallback.source === "postbus_package" && fallback.packageId) {
    return {
      kind: "SAVED_PACKAGE",
      presetId: fallback.packageId,
      presetName: fallback.packageName ?? "Saved pack size",
      box,
      evidence: { type: "preset" },
      autoApplicable: true,
      reason: "Only saved pack size for a single unmeasured item.",
    };
  }
  return {
    kind: "CUSTOM_DIMENSIONS",
    box,
    evidence: { type: fallback.source === "shopify" ? "shopify" : "default" },
    autoApplicable: true,
    reason:
      fallback.source === "shopify"
        ? "Single item with Shopify product measurements."
        : "Workspace default box for a single unmeasured item.",
  };
}

export function decidePackage(input: {
  shipment?: DecisionShipment | null;
  composition: ShipmentComposition;
  history: PackagingHistoryRow[];
  presets: PackageOption[];
  serviceCode: string;
  weightGrams?: number | null;
  /** Result of the existing single-unit rules (Shopify measurement, one preset, default). */
  fallback?: ResolvedShipmentDimensions | null;
  rejectedEvidenceIds?: string[];
}): PackageDecision {
  const shipment = input.shipment ?? null;
  if (shipment) {
    const record = readParcelDimensionRecord(shipment.metadata);
    if (manualDimensionLock(record?.source, shipment.metadata)) {
      return { kind: "KEEP_EXISTING", reason: "MERCHANT_OVERRIDE" };
    }
    if (!autopackShipmentWritable(shipment)) {
      return { kind: "KEEP_EXISTING", reason: "SHIPMENT_LOCKED" };
    }
  }

  const weight = Math.max(0, Number(input.weightGrams) || 0);
  const fallback = input.fallback ?? null;
  const fallbackDecision = () => {
    if (!fallback) return null;
    if (parcelBoxIssue(input.serviceCode, fallback, weight)) return null;
    return fromFallback(fallback);
  };

  if (!input.composition.ok) {
    return (
      fallbackDecision() ?? {
        kind: "MANUAL_REVIEW_REQUIRED",
        reason: input.composition.reason,
        message:
          input.composition.reason === "MISSING_VARIANT_IDS"
            ? "Some items have no Shopify variant, so past boxes cannot be matched. Choose a box."
            : "Nothing in this shipment needs a box.",
      }
    );
  }

  const key = input.composition.key;
  const rejected = new Set(input.rejectedEvidenceIds ?? []);
  const live = input.history
    .filter((row) => row.compositionKey === key && !row.supersededAt)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  if (!live.length) {
    return (
      fallbackDecision() ?? {
        kind: "MANUAL_REVIEW_REQUIRED",
        reason: "NO_HISTORY",
        message: "No past box for these exact items and quantities. Choose a box.",
      }
    );
  }

  const distinct = live.filter((row, index) => live.findIndex((other) => sameBox(other, row)) === index);
  if (distinct.length > 1) {
    return {
      kind: "MANUAL_REVIEW_REQUIRED",
      reason: "CONFLICTING_HISTORY",
      message: "Different boxes were used for these exact items. Choose the right one.",
    };
  }

  const latest = live[0];
  if (rejected.has(latest.id)) {
    return {
      kind: "MANUAL_REVIEW_REQUIRED",
      reason: "REJECTED_BY_MERCHANT",
      message: "You rejected the past box for this shipment. Choose a box.",
    };
  }

  const box = boxOf(latest);
  const invalid = parcelBoxIssue(input.serviceCode, box, weight);
  if (invalid) {
    return { kind: "MANUAL_REVIEW_REQUIRED", reason: "INVALID_FOR_SERVICE", message: invalid };
  }

  const level: EvidenceLevel = live.some((row) => row.evidenceLevel === "verified")
    ? "verified"
    : live.some((row) => row.evidenceLevel === "confirmed")
      ? "confirmed"
      : "entered";

  if (level === "entered") {
    return {
      kind: "MANUAL_REVIEW_REQUIRED",
      reason: "UNCONFIRMED_HISTORY",
      message: `A box of ${describe(box)} was typed for these items before but never booked or marked measured.`,
    };
  }

  const evidenceRow = live.find((row) => row.evidenceLevel === level) ?? latest;
  if (rejected.has(evidenceRow.id)) {
    return {
      kind: "MANUAL_REVIEW_REQUIRED",
      reason: "REJECTED_BY_MERCHANT",
      message: "You rejected the past box for this shipment. Choose a box.",
    };
  }
  const evidence: DecisionEvidence = { type: "history", historyId: evidenceRow.id, level };
  const autoApplicable = level === "verified";
  const reason =
    level === "verified"
      ? `Measured box used before for these exact items: ${describe(box)}.`
      : `Box booked before for these exact items: ${describe(box)}. Not marked measured.`;

  const preset = latest.presetId ? input.presets.find((row) => row.id === latest.presetId) : undefined;
  if (preset && sameBox(preset, box)) {
    return {
      kind: "SAVED_PACKAGE",
      presetId: preset.id,
      presetName: preset.name,
      box,
      evidence,
      autoApplicable,
      reason,
    };
  }
  return { kind: "CUSTOM_DIMENSIONS", box, evidence, autoApplicable, reason };
}

/** The resolved choice to store when a history decision is applied. */
export function historyDecisionChoice(
  decision: PackageDecision,
  options?: { merchantAccepted?: boolean }
): ResolvedShipmentDimensions | null {
  if (decision.kind !== "SAVED_PACKAGE" && decision.kind !== "CUSTOM_DIMENSIONS") return null;
  if (decision.evidence.type !== "history") return null;
  return {
    ...decision.box,
    source: "autopack_history",
    evidenceId: decision.evidence.historyId,
    ...(decision.kind === "SAVED_PACKAGE" ? { packageId: decision.presetId, packageName: decision.presetName } : {}),
    ...(options?.merchantAccepted ? { merchantAccepted: true } : {}),
  };
}

import {
  projectShipmentFromEvents,
  type ProjectionTrackingEvent,
  type ShipmentProjection,
} from "@/modules/india-post/event-mapper";

export const FORBIDDEN_RECONCILE_HOSTS = ["hgacoeoovjxkzfbesmvl", "app.indiapost.gov.in", "postbus.in"];

export function assertReconcileTargetIsolated(target: string) {
  const text = String(target ?? "").toLowerCase();
  for (const needle of FORBIDDEN_RECONCILE_HOSTS) {
    if (text.includes(needle)) {
      throw new Error(`STOP: reconcile target is production/forbidden (${needle}).`);
    }
  }
}

export type StoredTrackingEvent = ProjectionTrackingEvent;

export type ReconcileShipmentInput = {
  shipmentId: string;
  organizationId: string;
  current: ShipmentProjection;
  events: StoredTrackingEvent[];
};

export type ReconcileDryRun = {
  shipmentId: string;
  organizationId: string;
  before: ShipmentProjection;
  after: ShipmentProjection;
  proposedOperationalStatus: string | null;
  ambiguous: boolean;
  terminalChange: boolean;
};

export function dryRunShipmentReconcile(input: ReconcileShipmentInput): ReconcileDryRun {
  if (input.current.status === "FAILED" || input.current.status === "CANCELLED") {
    return {
      shipmentId: input.shipmentId,
      organizationId: input.organizationId,
      before: input.current,
      after: input.current,
      proposedOperationalStatus: input.current.operationalStatus,
      ambiguous: true,
      terminalChange: false,
    };
  }
  const after = projectShipmentFromEvents(input.events, {
    ...input.current,
    ndrAttemptCount: 0,
    rtoInitiatedAt: null,
    ndrReason: null,
    rtoReason: null,
    deliveredAt: null,
    lastEventAt: null,
    operationalStatus: null,
    ambiguous: false,
    status: input.current.status,
  });
  return {
    shipmentId: input.shipmentId,
    organizationId: input.organizationId,
    before: input.current,
    after,
    proposedOperationalStatus: after.operationalStatus,
    ambiguous: after.ambiguous,
    terminalChange: input.current.operationalStatus !== after.operationalStatus,
  };
}

export function applyReconcileWrites(): never {
  throw new Error("Reconcile apply is not authorized. Explicit production approval is required.");
}

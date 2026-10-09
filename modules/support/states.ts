import { AppError, ERROR_CODES } from "@/lib/api/errors";
import type {
  CancellationWorkflowStatus,
  ExchangeWorkflowStatus,
  ReturnWorkflowStatus,
  SupportTicketStatus,
} from "@/types/domain";

const TICKET_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  open: ["in_progress", "pending_customer", "pending_merchant"],
  in_progress: ["pending_customer", "pending_merchant", "resolved"],
  pending_customer: ["in_progress", "pending_merchant"],
  pending_merchant: ["in_progress", "pending_customer", "resolved"],
  resolved: ["closed", "reopened"],
  closed: ["reopened"],
  reopened: ["in_progress", "pending_customer", "pending_merchant", "resolved"],
};

const CANCELLATION_TRANSITIONS: Record<CancellationWorkflowStatus, CancellationWorkflowStatus[]> = {
  requested: ["under_review", "cancelled"],
  under_review: ["approved", "rejected", "needs_info", "cancelled"],
  needs_info: ["under_review", "cancelled"],
  approved: ["completed", "cancelled"],
  rejected: [],
  completed: [],
  cancelled: [],
};

const RETURN_TRANSITIONS: Record<ReturnWorkflowStatus, ReturnWorkflowStatus[]> = {
  requested: ["under_review", "cancelled"],
  under_review: ["approved", "rejected", "needs_info", "cancelled"],
  needs_info: ["under_review", "cancelled"],
  approved: ["awaiting_return_shipment", "cancelled"],
  awaiting_return_shipment: ["return_in_transit", "expired", "cancelled", "failed"],
  return_in_transit: ["return_received", "failed", "cancelled"],
  return_received: ["inspection", "failed"],
  inspection: ["refund_decision", "exchange_decision", "rejected"],
  refund_decision: ["completed"],
  exchange_decision: ["completed"],
  rejected: [],
  completed: [],
  cancelled: [],
  expired: [],
  failed: [],
};

const EXCHANGE_TRANSITIONS: Record<ExchangeWorkflowStatus, ExchangeWorkflowStatus[]> = {
  requested: ["under_review", "cancelled"],
  under_review: ["approved", "rejected", "needs_info", "cancelled"],
  needs_info: ["under_review", "cancelled"],
  approved: ["awaiting_return", "replacement_ready", "cancelled"],
  awaiting_return: ["replacement_ready", "failed", "cancelled"],
  replacement_ready: ["replacement_booked", "cancelled"],
  replacement_booked: ["completed", "failed"],
  rejected: [],
  completed: [],
  cancelled: [],
  failed: [],
};

export const OPEN_TICKET_STATUSES: SupportTicketStatus[] = [
  "open",
  "in_progress",
  "pending_customer",
  "pending_merchant",
  "reopened",
];

export function canTransitionTicket(from: SupportTicketStatus, to: SupportTicketStatus) {
  return TICKET_TRANSITIONS[from].includes(to);
}

export function assertTicketTransition(from: SupportTicketStatus, to: SupportTicketStatus) {
  if (from === to) return;
  if (!canTransitionTicket(from, to)) {
    throw new AppError(ERROR_CODES.CONFLICT, `Cannot change ticket status from ${from} to ${to}.`);
  }
}

export function canTransitionCancellation(from: CancellationWorkflowStatus, to: CancellationWorkflowStatus) {
  return CANCELLATION_TRANSITIONS[from].includes(to);
}

export function canTransitionReturn(from: ReturnWorkflowStatus, to: ReturnWorkflowStatus) {
  return RETURN_TRANSITIONS[from].includes(to);
}

export function canTransitionExchange(from: ExchangeWorkflowStatus, to: ExchangeWorkflowStatus) {
  return EXCHANGE_TRANSITIONS[from].includes(to);
}

export function assertWorkflowTransition(
  kind: "cancellation" | "return" | "exchange",
  from: string,
  to: string
) {
  if (from === to) return;
  const allowed =
    kind === "cancellation"
      ? canTransitionCancellation(from as CancellationWorkflowStatus, to as CancellationWorkflowStatus)
      : kind === "return"
        ? canTransitionReturn(from as ReturnWorkflowStatus, to as ReturnWorkflowStatus)
        : canTransitionExchange(from as ExchangeWorkflowStatus, to as ExchangeWorkflowStatus);
  if (!allowed) {
    throw new AppError(ERROR_CODES.CONFLICT, `Cannot change ${kind} from ${from} to ${to}.`);
  }
}

export const PRE_SHIPMENT_ORDER_STATUSES = ["IMPORTED", "READY", "PROCESSING"] as const;

export function canApprovePostbusCancellation(orderStatus?: string | null, hasBookedShipment?: boolean) {
  if (hasBookedShipment) return false;
  return PRE_SHIPMENT_ORDER_STATUSES.includes(
    (orderStatus ?? "") as (typeof PRE_SHIPMENT_ORDER_STATUSES)[number]
  );
}

export const MESSAGE_STATUS_RANK: Record<string, number> = {
  queued: 0,
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 99,
};

export function shouldApplyMessageStatus(current: string, next: string) {
  if (current === "failed") return false;
  const from = MESSAGE_STATUS_RANK[current] ?? -1;
  const to = MESSAGE_STATUS_RANK[next] ?? -1;
  if (next === "failed") return from < 99;
  return to > from;
}

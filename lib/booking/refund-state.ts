export const REFUND_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_TARGET_STATUSES = [
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type RefundTargetStatus = (typeof REFUND_TARGET_STATUSES)[number];

const REFUND_TRANSITIONS: Record<RefundStatus, readonly RefundStatus[]> = {
  /*
   * Un reembolso manual puede pasar
   * directamente de PENDING a COMPLETED.
   *
   * Un gateway futuro podrá utilizar
   * PROCESSING.
   */
  PENDING: ["PROCESSING", "COMPLETED", "CANCELLED"],

  PROCESSING: ["COMPLETED", "FAILED"],

  /*
   * Un fallo puede reintentarse.
   */
  FAILED: ["PROCESSING"],

  COMPLETED: [],

  CANCELLED: [],
};

export function isRefundStatus(value: unknown): value is RefundStatus {
  return (
    typeof value === "string" && REFUND_STATUSES.includes(value as RefundStatus)
  );
}

export function isRefundTargetStatus(
  value: unknown,
): value is RefundTargetStatus {
  return (
    typeof value === "string" &&
    REFUND_TARGET_STATUSES.includes(value as RefundTargetStatus)
  );
}

export function isRefundTransitionAllowed(
  currentStatus: RefundStatus,
  targetStatus: RefundStatus,
) {
  return REFUND_TRANSITIONS[currentStatus].includes(targetStatus);
}

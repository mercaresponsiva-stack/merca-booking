export const PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_TARGET_STATUSES = ["PAID", "FAILED", "REFUNDED"] as const;

export type PaymentTargetStatus = (typeof PAYMENT_TARGET_STATUSES)[number];

const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["PAID", "FAILED"],

  PAID: ["REFUNDED"],

  FAILED: [],

  REFUNDED: [],
};

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return (
    typeof value === "string" &&
    PAYMENT_STATUSES.includes(value as PaymentStatus)
  );
}

export function isPaymentTargetStatus(
  value: unknown,
): value is PaymentTargetStatus {
  return (
    typeof value === "string" &&
    PAYMENT_TARGET_STATUSES.includes(value as PaymentTargetStatus)
  );
}

export function isPaymentTransitionAllowed(
  currentStatus: PaymentStatus,
  targetStatus: PaymentStatus,
) {
  return PAYMENT_TRANSITIONS[currentStatus].includes(targetStatus);
}

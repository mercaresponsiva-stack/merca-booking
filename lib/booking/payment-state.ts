export const PAYMENT_STATUSES = [
  "PENDING",
  "PAID",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/*
 * Estados a los que una operación nueva
 * puede mover un Payment.
 *
 * REFUNDED se conserva únicamente para
 * compatibilidad con registros históricos.
 *
 * Toda devolución nueva debe utilizar
 * el modelo Refund.
 */
export const PAYMENT_TARGET_STATUSES = ["PAID", "FAILED"] as const;

export type PaymentTargetStatus = (typeof PAYMENT_TARGET_STATUSES)[number];

const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  PENDING: ["PAID", "FAILED"],

  /*
   * Un Payment PAID es evidencia histórica
   * de que el dinero ingresó.
   *
   * Ya no se modifica a REFUNDED.
   * Las devoluciones se representan mediante
   * Refund.
   */
  PAID: [],

  FAILED: [],

  /*
   * Estado histórico del sistema anterior.
   * No admite nuevas transiciones.
   */
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

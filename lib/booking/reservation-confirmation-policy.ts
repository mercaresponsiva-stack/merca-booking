import type { ReservationStatus } from "@/lib/booking/reservation-state";

export const RESERVATION_CONFIRMATION_REASON_MAX_LENGTH =
  1000;

type ValidateReservationForConfirmationInput = {
  status: ReservationStatus;

  initialPaymentSatisfied: boolean;

  reason?: string | null;
};

/*
 * Valida el contrato propio de la
 * confirmación de una reserva.
 *
 * La confirmación:
 *
 * - solo parte de PENDING
 * - requiere que el pago inicial aplicable
 *   esté cubierto
 * - conserva fechas, precios y asignaciones
 * - admite un motivo administrativo opcional
 *
 * La existencia y pertenencia del actor se
 * validan dentro de la operación transaccional.
 */
export function validateReservationForConfirmation({
  status,

  initialPaymentSatisfied,

  reason,
}: ValidateReservationForConfirmationInput) {
  if (
    status !==
    "PENDING"
  ) {
    throw new Error(
      "RESERVATION_NOT_ELIGIBLE_FOR_CONFIRMATION",
    );
  }

  if (
    !initialPaymentSatisfied
  ) {
    throw new Error(
      "INITIAL_PAYMENT_REQUIRED_FOR_CONFIRMATION",
    );
  }

  const normalizedReason =
    reason?.trim() ||
    null;

  if (
    normalizedReason &&
    normalizedReason.length >
      RESERVATION_CONFIRMATION_REASON_MAX_LENGTH
  ) {
    throw new Error(
      "INVALID_CONFIRMATION_REASON",
    );
  }

  return {
    currentStatus:
      status,

    nextStatus:
      "CONFIRMED" as const,

    reason:
      normalizedReason,
  };
}
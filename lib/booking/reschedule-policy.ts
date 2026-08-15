import { fromCents, toCents } from "@/lib/booking/money";

import type { ReservationStatus } from "@/lib/booking/reservation-state";

export type ReschedulePaymentOption = "FULL" | "DEPOSIT_50" | null;

type ValidateRescheduleInput = {
  status: ReservationStatus;

  startAt: Date;

  requestedAt: Date;

  hasActiveRefund: boolean;
};

type ResolveRescheduleFinancialImpactInput = {
  currentStatus: "PENDING" | "CONFIRMED";

  paymentOption: ReschedulePaymentOption;

  currentTotal: number;

  newTotal: number;

  netPaid: number;
};

/*
 * Estados desde los cuales permitimos
 * una reprogramación normal.
 *
 * CHECKED_IN y posteriores representan
 * un servicio que ya comenzó.
 *
 * CANCELLED / NO_SHOW tampoco se
 * reabren mediante este flujo.
 */
export function validateReservationForReschedule({
  status,
  startAt,
  requestedAt,
  hasActiveRefund,
}: ValidateRescheduleInput) {
  if (status !== "PENDING" && status !== "CONFIRMED") {
    throw new Error("RESERVATION_NOT_RESCHEDULABLE");
  }

  if (requestedAt >= startAt) {
    throw new Error("RESCHEDULE_AFTER_SERVICE_START");
  }

  /*
   * No modificamos el contrato mientras
   * existe dinero saliendo mediante un
   * Refund todavía no resuelto.
   */
  if (hasActiveRefund) {
    throw new Error("RESCHEDULE_ACTIVE_REFUND");
  }

  return {
    currentStatus: status,
  };
}

/*
 * Resuelve únicamente el impacto
 * financiero de un cambio de precio.
 *
 * No sabe:
 *
 * - qué tipo de negocio es
 * - por qué cambió el precio
 * - cómo se calculó el precio
 * - qué representa startAt/endAt
 */
export function resolveRescheduleFinancialImpact({
  currentStatus,
  paymentOption,
  currentTotal,
  newTotal,
  netPaid,
}: ResolveRescheduleFinancialImpactInput) {
  const currentTotalCents = toCents(currentTotal);

  const newTotalCents = toCents(newTotal);

  const netPaidCents = toCents(netPaid);

  if (currentTotalCents < 0 || newTotalCents < 0 || netPaidCents < 0) {
    throw new Error("INVALID_RESCHEDULE_FINANCIAL_VALUES");
  }

  /*
   * Dinero que quedó pagado por encima
   * del nuevo valor contractual.
   *
   * Será la base para un futuro:
   *
   * Refund
   * basis = PRICE_ADJUSTMENT
   */
  const overpaymentCents = Math.max(netPaidCents - newTotalCents, 0);

  /*
   * Saldo matemático después de aplicar
   * el nuevo precio.
   */
  const balanceCents = Math.max(newTotalCents - netPaidCents, 0);

  let requiredInitialPaymentCents = 0;

  if (paymentOption === "FULL") {
    requiredInitialPaymentCents = newTotalCents;
  }

  if (paymentOption === "DEPOSIT_50") {
    requiredInitialPaymentCents = Math.round(newTotalCents / 2);
  }

  /*
   * paymentOption = null corresponde
   * principalmente a historial anterior
   * al flujo actual.
   *
   * No inventamos una regla de anticipo
   * que ese contrato nunca tuvo.
   */
  const initialPaymentShortfallCents =
    paymentOption === null
      ? 0
      : Math.max(requiredInitialPaymentCents - netPaidCents, 0);

  let nextStatus: "PENDING" | "CONFIRMED" = currentStatus;

  /*
   * Una reserva ya CONFIRMED puede volver
   * a PENDING si el nuevo precio hace que
   * el dinero pagado ya no cubra el
   * anticipo requerido.
   *
   * No hacemos el movimiento inverso
   * automáticamente:
   *
   * PENDING -> CONFIRMED
   *
   * porque la confirmación debe seguir
   * pasando por el flujo normal de estado.
   */
  if (
    currentStatus === "CONFIRMED" &&
    paymentOption !== null &&
    initialPaymentShortfallCents > 0
  ) {
    nextStatus = "PENDING";
  }

  return {
    currentTotal: fromCents(currentTotalCents),

    newTotal: fromCents(newTotalCents),

    priceDifference: fromCents(newTotalCents - currentTotalCents),

    netPaid: fromCents(netPaidCents),

    balance: fromCents(balanceCents),

    overpayment: fromCents(overpaymentCents),

    requiredInitialPayment:
      paymentOption === null ? null : fromCents(requiredInitialPaymentCents),

    initialPaymentShortfall: fromCents(initialPaymentShortfallCents),

    previousStatus: currentStatus,

    nextStatus,

    statusChanged: nextStatus !== currentStatus,
  };
}

type ValidateRescheduleIntervalInput = {
  currentStartAt: Date;
  currentEndAt: Date;

  newStartAt: Date;
  newEndAt: Date;
};

export function validateRescheduleInterval({
  currentStartAt,
  currentEndAt,
  newStartAt,
  newEndAt,
}: ValidateRescheduleIntervalInput) {
  if (newEndAt <= newStartAt) {
    throw new Error("INVALID_RESCHEDULE_INTERVAL");
  }

  const sameStart = currentStartAt.getTime() === newStartAt.getTime();

  const sameEnd = currentEndAt.getTime() === newEndAt.getTime();

  if (sameStart && sameEnd) {
    throw new Error("RESCHEDULE_SAME_INTERVAL");
  }

  return {
    changed: true,
  };
}

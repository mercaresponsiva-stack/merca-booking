import {
  toCents,
} from "@/lib/booking/money";

import type {
  ReservationStatus,
} from "@/lib/booking/reservation-state";

export type ReservationCheckoutTiming =
  | "EARLY"
  | "ON_TIME"
  | "LATE";

export type ReservationCheckoutPaymentSummary = {
  total:
    number;

  balance:
    number;

  pending:
    number;

  refundPending:
    number;

  netPaid:
    number;
};

type ValidateReservationForCheckoutInput = {
  status:
    ReservationStatus;

  scheduledEndAt:
    Date;

  requestedAt:
    Date;

  reason:
    string | null;

  paymentSummary:
    ReservationCheckoutPaymentSummary;
};

type ValidateReservationForCompletionInput = {
  status:
    ReservationStatus;

  paymentSummary:
    ReservationCheckoutPaymentSummary;
};

type CheckoutFinancialSnapshot = {
  totalCents:
    number;

  balanceCents:
    number;

  pendingCents:
    number;

  refundPendingCents:
    number;

  netPaidCents:
    number;
};

function assertValidDate(
  value:
    Date,

  errorCode:
    string,
) {
  if (
    Number.isNaN(
      value.getTime(),
    )
  ) {
    throw new Error(
      errorCode,
    );
  }
}

function moneyToSafeCents(
  value:
    number,
) {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <
      0
  ) {
    throw new Error(
      "INVALID_CHECK_OUT_FINANCIAL_VALUES",
    );
  }

  const cents =
    toCents(
      value,
    );

  if (
    !Number.isSafeInteger(
      cents,
    )
  ) {
    throw new Error(
      "CHECK_OUT_FINANCIAL_OVERFLOW",
    );
  }

  return cents;
}

function resolveCheckoutFinancialSnapshot(
  paymentSummary:
    ReservationCheckoutPaymentSummary,
): CheckoutFinancialSnapshot {
  const totalCents =
    moneyToSafeCents(
      paymentSummary.total,
    );

  const balanceCents =
    moneyToSafeCents(
      paymentSummary.balance,
    );

  const pendingCents =
    moneyToSafeCents(
      paymentSummary.pending,
    );

  const refundPendingCents =
    moneyToSafeCents(
      paymentSummary.refundPending,
    );

  const netPaidCents =
    moneyToSafeCents(
      paymentSummary.netPaid,
    );

  const expectedBalanceCents =
    Math.max(
      totalCents -
        netPaidCents,

      0,
    );

  if (
    balanceCents !==
    expectedBalanceCents
  ) {
    throw new Error(
      "INVALID_CHECK_OUT_FINANCIAL_VALUES",
    );
  }

  return {
    totalCents,
    balanceCents,
    pendingCents,
    refundPendingCents,
    netPaidCents,
  };
}

export function getReservationCheckoutTiming({
  scheduledEndAt,
  requestedAt,
}: {
  scheduledEndAt:
    Date;

  requestedAt:
    Date;
}): ReservationCheckoutTiming {
  assertValidDate(
    scheduledEndAt,
    "INVALID_CHECK_OUT_TIMESTAMP",
  );

  assertValidDate(
    requestedAt,
    "INVALID_CHECK_OUT_TIMESTAMP",
  );

  if (
    requestedAt <
    scheduledEndAt
  ) {
    return "EARLY";
  }

  if (
    requestedAt.getTime() ===
    scheduledEndAt.getTime()
  ) {
    return "ON_TIME";
  }

  return "LATE";
}

/*
 * Registra la salida física del huésped.
 *
 * CHECKED_OUT deja de ser pagable y deja
 * de consumir inventario operativo.
 *
 * Por eso no permitimos efectuarlo mientras
 * exista deuda o un pago todavía pendiente
 * de resolución.
 *
 * Un Refund pendiente no impide que el
 * huésped salga. Sí impedirá cerrar después
 * la reserva como COMPLETED.
 */
export function validateReservationForCheckout({
  status,

  scheduledEndAt,
  requestedAt,

  reason,

  paymentSummary,
}: ValidateReservationForCheckoutInput) {
  if (
    status !==
    "CHECKED_IN"
  ) {
    throw new Error(
      "RESERVATION_NOT_ELIGIBLE_FOR_CHECK_OUT",
    );
  }

  const timing =
    getReservationCheckoutTiming({
      scheduledEndAt,
      requestedAt,
    });

  const financial =
    resolveCheckoutFinancialSnapshot(
      paymentSummary,
    );

  if (
    financial.pendingCents >
    0
  ) {
    throw new Error(
      "CHECK_OUT_PENDING_PAYMENT",
    );
  }

  if (
    financial.balanceCents >
    0
  ) {
    throw new Error(
      "CHECK_OUT_BALANCE_DUE",
    );
  }

  if (
    timing ===
      "EARLY" &&
    !reason?.trim()
  ) {
    throw new Error(
      "EARLY_CHECK_OUT_REASON_REQUIRED",
    );
  }

  return {
    currentStatus:
      status,

    nextStatus:
      "CHECKED_OUT" as const,

    timing,

    scheduledEndAt,
    checkedOutAt:
      requestedAt,

    hasRefundPending:
      financial.refundPendingCents >
      0,

    financial,
  };
}

/*
 * COMPLETED representa cierre administrativo,
 * no solamente salida física.
 *
 * Requiere:
 *
 * - contrato totalmente pagado
 * - ningún pago pendiente
 * - ningún reembolso pendiente
 * - netPaid exactamente igual al total
 */
export function validateReservationForCompletion({
  status,

  paymentSummary,
}: ValidateReservationForCompletionInput) {
  if (
    status !==
    "CHECKED_OUT"
  ) {
    throw new Error(
      "RESERVATION_NOT_ELIGIBLE_FOR_COMPLETION",
    );
  }

  const financial =
    resolveCheckoutFinancialSnapshot(
      paymentSummary,
    );

  if (
    financial.balanceCents >
      0 ||
    financial.pendingCents >
      0 ||
    financial.refundPendingCents >
      0 ||
    financial.netPaidCents !==
      financial.totalCents
  ) {
    throw new Error(
      "RESERVATION_FINANCIAL_SETTLEMENT_REQUIRED_FOR_COMPLETION",
    );
  }

  return {
    currentStatus:
      status,

    nextStatus:
      "COMPLETED" as const,

    financial,
  };
}
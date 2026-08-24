import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

import type {
  ReservationStatus,
} from "@/lib/booking/reservation-state";

type ValidateReservationForStayExtensionInput = {
  status:
    ReservationStatus;

  currentEndAt:
    Date;

  newEndAt:
    Date;

  requestedAt:
    Date;

  hasActiveRefund:
    boolean;
};

type ResolveStayExtensionFinancialImpactInput = {
  currentSubtotal:
    number;

  currentTotal:
    number;

  additionalServiceSubtotal:
    number;

  additionalOptionSubtotal:
    number;

  netPaid:
    number;
};

function assertValidDate(
  value:
    Date,

  errorCode:
    string,
) {
  if (
    !(value instanceof Date) ||
    Number.isNaN(
      value.getTime(),
    )
  ) {
    throw new Error(
      errorCode,
    );
  }
}

function financialValueToCents(
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
      "INVALID_STAY_EXTENSION_FINANCIAL_VALUES",
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
      "STAY_EXTENSION_FINANCIAL_OVERFLOW",
    );
  }

  return cents;
}

function addSafeCents(
  ...values:
    number[]
) {
  const result =
    values.reduce(
      (
        total,
        value,
      ) =>
        total +
        value,

      0,
    );

  if (
    !Number.isSafeInteger(
      result,
    )
  ) {
    throw new Error(
      "STAY_EXTENSION_FINANCIAL_OVERFLOW",
    );
  }

  return result;
}

/*
 * Una extensión operativa no es una
 * reprogramación normal:
 *
 * - el servicio ya comenzó
 * - startAt permanece intacto
 * - el estado continúa CHECKED_IN
 * - únicamente puede aumentar endAt
 */
export function validateReservationForStayExtension({
  status,

  currentEndAt,
  newEndAt,

  requestedAt,

  hasActiveRefund,
}: ValidateReservationForStayExtensionInput) {
  if (
    status !==
    "CHECKED_IN"
  ) {
    throw new Error(
      "RESERVATION_NOT_EXTENDABLE",
    );
  }

  assertValidDate(
    currentEndAt,
    "INVALID_CURRENT_STAY_END",
  );

  assertValidDate(
    newEndAt,
    "INVALID_NEW_STAY_END",
  );

  assertValidDate(
    requestedAt,
    "INVALID_STAY_EXTENSION_REQUEST_TIME",
  );

  if (
    hasActiveRefund
  ) {
    throw new Error(
      "STAY_EXTENSION_ACTIVE_REFUND",
    );
  }

  if (
    newEndAt <=
    currentEndAt
  ) {
    throw new Error(
      "STAY_EXTENSION_END_MUST_INCREASE",
    );
  }

  /*
   * Una recepción puede registrar la
   * extensión después de que venció la
   * salida original.
   *
   * La nueva salida, sin embargo, debe
   * seguir estando en el futuro.
   */
  if (
    newEndAt <=
    requestedAt
  ) {
    throw new Error(
      "STAY_EXTENSION_END_MUST_BE_FUTURE",
    );
  }

  return {
    previousStatus:
      "CHECKED_IN" as const,

    nextStatus:
      "CHECKED_IN" as const,

    statusChanged:
      false as const,
  };
}

/*
 * Conserva intactos los importes del
 * contrato existente y agrega solamente
 * los cargos de la extensión.
 *
 * currentSubtotal y currentTotal se
 * incrementan por separado para no borrar
 * diferencias históricas entre ambos.
 */
export function resolveStayExtensionFinancialImpact({
  currentSubtotal,
  currentTotal,

  additionalServiceSubtotal,
  additionalOptionSubtotal,

  netPaid,
}: ResolveStayExtensionFinancialImpactInput) {
  const currentSubtotalCents =
    financialValueToCents(
      currentSubtotal,
    );

  const currentTotalCents =
    financialValueToCents(
      currentTotal,
    );

  const additionalServiceSubtotalCents =
    financialValueToCents(
      additionalServiceSubtotal,
    );

  const additionalOptionSubtotalCents =
    financialValueToCents(
      additionalOptionSubtotal,
    );

  const netPaidCents =
    financialValueToCents(
      netPaid,
    );

  const additionalChargeCents =
    addSafeCents(
      additionalServiceSubtotalCents,
      additionalOptionSubtotalCents,
    );

  const newSubtotalCents =
    addSafeCents(
      currentSubtotalCents,
      additionalChargeCents,
    );

  const newTotalCents =
    addSafeCents(
      currentTotalCents,
      additionalChargeCents,
    );

  const balanceCents =
    Math.max(
      newTotalCents -
        netPaidCents,

      0,
    );

  const creditCents =
    Math.max(
      netPaidCents -
        newTotalCents,

      0,
    );

  return {
    currentSubtotal:
      fromCents(
        currentSubtotalCents,
      ),

    currentTotal:
      fromCents(
        currentTotalCents,
      ),

    additionalServiceSubtotal:
      fromCents(
        additionalServiceSubtotalCents,
      ),

    additionalOptionSubtotal:
      fromCents(
        additionalOptionSubtotalCents,
      ),

    additionalCharge:
      fromCents(
        additionalChargeCents,
      ),

    newSubtotal:
      fromCents(
        newSubtotalCents,
      ),

    newTotal:
      fromCents(
        newTotalCents,
      ),

    netPaid:
      fromCents(
        netPaidCents,
      ),

    balance:
      fromCents(
        balanceCents,
      ),

    credit:
      fromCents(
        creditCents,
      ),

    previousStatus:
      "CHECKED_IN" as const,

    nextStatus:
      "CHECKED_IN" as const,

    statusChanged:
      false as const,
  };
}
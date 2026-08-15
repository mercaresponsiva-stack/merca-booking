const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type CancellationInitiator = "CUSTOMER" | "PROVIDER";

export type AutomaticCancellationBasis =
  | "RETRACTO"
  | "DESISTIMIENTO"
  | "PROVIDER_CANCELLATION";

type ResolveCancellationBasisInput = {
  initiator: CancellationInitiator;

  retractoEligible: boolean;

  contractCreatedAt: Date;

  requestedAt: Date;

  serviceStartAt: Date;

  fullRefundDays: number;
};

export type CancellationBasisResolution = {
  basis: AutomaticCancellationBasis;

  contractElapsedDays: number;
};

export function resolveCancellationBasis({
  initiator,
  retractoEligible,
  contractCreatedAt,
  requestedAt,
  serviceStartAt,
  fullRefundDays,
}: ResolveCancellationBasisInput): CancellationBasisResolution {
  validateDate(contractCreatedAt, "INVALID_CONTRACT_CREATED_AT");

  validateDate(requestedAt, "INVALID_CANCELLATION_REQUESTED_AT");

  validateDate(serviceStartAt, "INVALID_SERVICE_START_AT");

  if (!Number.isInteger(fullRefundDays) || fullRefundDays < 0) {
    throw new Error("INVALID_FULL_REFUND_DAYS");
  }

  if (requestedAt < contractCreatedAt) {
    throw new Error("CANCELLATION_BEFORE_CONTRACT_CREATED");
  }

  /*
   * Esta operación corresponde a cancelaciones
   * anteriores al inicio del servicio.
   *
   * Una reserva cuyo servicio ya inició debe
   * seguir otro flujo.
   */
  if (requestedAt >= serviceStartAt) {
    throw new Error("CANCELLATION_AFTER_SERVICE_START");
  }

  const contractElapsedDays = getElapsedFullDays(
    contractCreatedAt,
    requestedAt,
  );

  // ─────────────────────────────────────────────
  // PROVIDER
  // ─────────────────────────────────────────────

  if (initiator === "PROVIDER") {
    return {
      basis: "PROVIDER_CANCELLATION",

      contractElapsedDays,
    };
  }

  // ─────────────────────────────────────────────
  // CUSTOMER
  // ─────────────────────────────────────────────

  const retractoDeadline =
    contractCreatedAt.getTime() + fullRefundDays * MILLISECONDS_PER_DAY;

  const withinRetractoPeriod = requestedAt.getTime() <= retractoDeadline;

  if (retractoEligible && withinRetractoPeriod) {
    return {
      basis: "RETRACTO",

      contractElapsedDays,
    };
  }

  return {
    basis: "DESISTIMIENTO",

    contractElapsedDays,
  };
}

export function getElapsedFullDays(from: Date, to: Date) {
  validateDate(from, "INVALID_ELAPSED_FROM_DATE");

  validateDate(to, "INVALID_ELAPSED_TO_DATE");

  if (to < from) {
    throw new Error("INVALID_ELAPSED_DATE_ORDER");
  }

  return Math.floor((to.getTime() - from.getTime()) / MILLISECONDS_PER_DAY);
}

function validateDate(value: Date, errorCode: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(errorCode);
  }
}

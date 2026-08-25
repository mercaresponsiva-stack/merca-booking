import type {
  ReservationStatus,
} from "@/lib/booking/reservation-state";

type ReservationNoShowDateInput =
  | Date
  | string;

type IsReservationNoShowDueInput = {
  status:
    ReservationStatus;

  scheduledStartAt:
    ReservationNoShowDateInput;

  now:
    ReservationNoShowDateInput;
};

type ValidateReservationForNoShowInput = {
  status:
    ReservationStatus;

  scheduledStartAt:
    Date;

  requestedAt:
    Date;

  reason:
    | string
    | null
    | undefined;
};

function resolveTimestamp(
  value:
    ReservationNoShowDateInput,
) {
  return value instanceof
    Date
    ? value.getTime()
    : new Date(
        value,
      ).getTime();
}

function getValidTimestamp(
  value:
    ReservationNoShowDateInput,

  errorCode:
    string,
) {
  const timestamp =
    resolveTimestamp(
      value,
    );

  if (
    !Number.isFinite(
      timestamp,
    )
  ) {
    throw new Error(
      errorCode,
    );
  }

  return timestamp;
}

/*
 * Indica si una reserva ya alcanzó el
 * instante a partir del cual puede marcarse
 * como no presentada.
 *
 * Actualmente no existe una tolerancia de
 * llegada configurable. Por eso el límite
 * mínimo es exactamente Reservation.startAt.
 */
export function isReservationNoShowDue({
  status,

  scheduledStartAt,

  now,
}: IsReservationNoShowDueInput) {
  if (
    status !==
    "CONFIRMED"
  ) {
    return false;
  }

  const scheduledStartTimestamp =
    resolveTimestamp(
      scheduledStartAt,
    );

  const nowTimestamp =
    resolveTimestamp(
      now,
    );

  if (
    !Number.isFinite(
      scheduledStartTimestamp,
    ) ||
    !Number.isFinite(
      nowTimestamp,
    )
  ) {
    return false;
  }

  return (
    nowTimestamp >=
    scheduledStartTimestamp
  );
}

/*
 * Valida el estado, el momento y el motivo
 * de la operación NO_SHOW.
 *
 * No existe un límite máximo temporal:
 * una reserva CONFIRMED atrasada debe poder
 * cerrarse aunque su intervalo ya haya
 * finalizado.
 *
 * Los pagos pendientes se validarán dentro
 * de la operación transaccional, después de
 * calcular el resumen financiero vigente.
 */
export function validateReservationForNoShow({
  status,

  scheduledStartAt,

  requestedAt,

  reason,
}: ValidateReservationForNoShowInput) {
  if (
    status !==
    "CONFIRMED"
  ) {
    throw new Error(
      "RESERVATION_NOT_ELIGIBLE_FOR_NO_SHOW",
    );
  }

  const scheduledStartTimestamp =
    getValidTimestamp(
      scheduledStartAt,
      "INVALID_NO_SHOW_TIMESTAMPS",
    );

  const requestedTimestamp =
    getValidTimestamp(
      requestedAt,
      "INVALID_NO_SHOW_TIMESTAMPS",
    );

  if (
    requestedTimestamp <
    scheduledStartTimestamp
  ) {
    throw new Error(
      "NO_SHOW_NOT_DUE",
    );
  }

  const normalizedReason =
    reason?.trim() ||
    null;

  if (
    !normalizedReason
  ) {
    throw new Error(
      "NO_SHOW_REASON_REQUIRED",
    );
  }

  if (
    normalizedReason.length >
    1000
  ) {
    throw new Error(
      "INVALID_NO_SHOW_REASON",
    );
  }

  return {
    currentStatus:
      status,

    nextStatus:
      "NO_SHOW" as const,

    scheduledStartAt,

    markedNoShowAt:
      requestedAt,

    reason:
      normalizedReason,
  };
}
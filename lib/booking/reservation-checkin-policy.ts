import type {
  ReservationStatus,
} from "@/lib/booking/reservation-state";

export type ReservationCheckinTiming =
  | "EARLY"
  | "ON_TIME"
  | "LATE";

type ResolveReservationCheckinTimingInput = {
  scheduledStartAt:
    Date;

  requestedAt:
    Date;
};

type IsReservationCheckinDueInput = {
  status:
    ReservationStatus;

  startAt:
    Date;

  now:
    Date;
};

type ValidateReservationForCheckinInput = {
  status:
    ReservationStatus;

  scheduledStartAt:
    Date;

  scheduledEndAt:
    Date;

  requestedAt:
    Date;

  reason:
    string | null;
};

function getValidTimestamp(
  value:
    Date,

  errorCode:
    string,
) {
  const timestamp =
    value.getTime();

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
 * Clasifica la hora real del check-in
 * frente al inicio contractual.
 *
 * No modifica Reservation.startAt.
 */
export function resolveReservationCheckinTiming({
  scheduledStartAt,

  requestedAt,
}: ResolveReservationCheckinTimingInput): ReservationCheckinTiming {
  const scheduledStartTimestamp =
    getValidTimestamp(
      scheduledStartAt,
      "INVALID_CHECK_IN_TIMESTAMPS",
    );

  const requestedTimestamp =
    getValidTimestamp(
      requestedAt,
      "INVALID_CHECK_IN_TIMESTAMPS",
    );

  if (
    requestedTimestamp <
    scheduledStartTimestamp
  ) {
    return "EARLY";
  }

  if (
    requestedTimestamp ===
    scheduledStartTimestamp
  ) {
    return "ON_TIME";
  }

  return "LATE";
}

/*
 * Permite a la interfaz distinguir entre:
 *
 * - check-in programado o vencido
 * - check-in anticipado
 *
 * La autorización definitiva siempre se
 * vuelve a validar en el servidor.
 */
export function isReservationCheckinDue({
  status,

  startAt,

  now,
}: IsReservationCheckinDueInput) {
  if (
    status !==
    "CONFIRMED"
  ) {
    return false;
  }

  const startTimestamp =
    startAt.getTime();

  const nowTimestamp =
    now.getTime();

  if (
    !Number.isFinite(
      startTimestamp,
    ) ||
    !Number.isFinite(
      nowTimestamp,
    )
  ) {
    return false;
  }

  return (
    nowTimestamp >=
    startTimestamp
  );
}

/*
 * Valida únicamente el estado y la dimensión
 * temporal del check-in.
 *
 * El pago inicial, los recursos obligatorios
 * y la integridad de las asignaciones se
 * validan dentro de la operación transaccional.
 */
export function validateReservationForCheckin({
  status,

  scheduledStartAt,

  scheduledEndAt,

  requestedAt,

  reason,
}: ValidateReservationForCheckinInput) {
  if (
    status !==
    "CONFIRMED"
  ) {
    throw new Error(
      "RESERVATION_NOT_ELIGIBLE_FOR_CHECK_IN",
    );
  }

  const scheduledStartTimestamp =
    getValidTimestamp(
      scheduledStartAt,
      "INVALID_CHECK_IN_TIMESTAMPS",
    );

  const scheduledEndTimestamp =
    getValidTimestamp(
      scheduledEndAt,
      "INVALID_CHECK_IN_TIMESTAMPS",
    );

  const requestedTimestamp =
    getValidTimestamp(
      requestedAt,
      "INVALID_CHECK_IN_TIMESTAMPS",
    );

  if (
    scheduledEndTimestamp <=
    scheduledStartTimestamp
  ) {
    throw new Error(
      "INVALID_CHECK_IN_INTERVAL",
    );
  }

  if (
    requestedTimestamp >=
    scheduledEndTimestamp
  ) {
    throw new Error(
      "CHECK_IN_WINDOW_CLOSED",
    );
  }

  const normalizedReason =
    reason?.trim() ||
    null;

  const timing =
    resolveReservationCheckinTiming({
      scheduledStartAt,

      requestedAt,
    });

  if (
    timing ===
      "EARLY" &&
    !normalizedReason
  ) {
    throw new Error(
      "EARLY_CHECK_IN_REASON_REQUIRED",
    );
  }

  return {
    currentStatus:
      status,

    nextStatus:
      "CHECKED_IN" as const,

    timing,

    earlyCheckin:
      timing ===
      "EARLY",

    reason:
      normalizedReason,
  };
}
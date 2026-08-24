export type ReservationCheckoutTimingState =
  | "NOT_APPLICABLE"
  | "SCHEDULED"
  | "DUE";

export type ResolveReservationCheckoutTimingInput = {
  status: string;

  endAt:
    | Date
    | string
    | number;

  /*
   * Inyectable para pruebas deterministas.
   *
   * En producción utiliza el reloj actual.
   */
  now?:
    | Date
    | string
    | number;
};

function normalizeInstant(
  value:
    | Date
    | string
    | number,

  errorCode: string,
) {
  const normalized =
    value instanceof Date
      ? new Date(
          value.getTime(),
        )
      : new Date(
          value,
        );

  if (
    Number.isNaN(
      normalized.getTime(),
    )
  ) {
    throw new Error(
      errorCode,
    );
  }

  return normalized;
}

/*
 * Estado temporal derivado.
 *
 * No modifica Reservation.status.
 * No libera asignaciones.
 * No crea eventos históricos.
 *
 * Solamente indica si una reserva que sigue
 * CHECKED_IN ya alcanzó su salida programada.
 */
export function resolveReservationCheckoutTiming({
  status,
  endAt,
  now = new Date(),
}: ResolveReservationCheckoutTimingInput): ReservationCheckoutTimingState {
  const normalizedEndAt =
    normalizeInstant(
      endAt,
      "INVALID_RESERVATION_CHECKOUT_END_AT",
    );

  const normalizedNow =
    normalizeInstant(
      now,
      "INVALID_RESERVATION_CHECKOUT_NOW",
    );

  if (
    status !==
    "CHECKED_IN"
  ) {
    return "NOT_APPLICABLE";
  }

  if (
    normalizedNow.getTime() >=
    normalizedEndAt.getTime()
  ) {
    return "DUE";
  }

  return "SCHEDULED";
}

export function isReservationCheckoutDue(
  input:
    ResolveReservationCheckoutTimingInput,
) {
  return (
    resolveReservationCheckoutTiming(
      input,
    ) ===
    "DUE"
  );
}
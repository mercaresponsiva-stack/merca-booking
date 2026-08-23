export type ReservationOptionOperationalGroupInput = {
  reservationId: string;

  reservationOptionId: string;

  reservationServiceId:
    string | null;

  serviceOptionId:
    string | null;

  optionId:
    string | null;

  /*
   * Conservamos el intervalo RAW.
   *
   * null/null significa que la Option
   * hereda el intervalo de Reservation.
   *
   * No agrupamos una Option heredada con
   * otra explícita aunque sus fechas
   * efectivas coincidan actualmente:
   * reaccionan distinto ante reschedule.
   */
  startAt:
    | Date
    | string
    | null;

  endAt:
    | Date
    | string
    | null;
};

function requireIdentifier(
  value: string,
  errorCode: string,
) {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      errorCode,
    );
  }

  return normalized;
}

function normalizeOptionalIdentifier(
  value:
    | string
    | null,
) {
  if (value === null) {
    return null;
  }

  const normalized =
    value.trim();

  return normalized ||
    null;
}

function normalizeDate(
  value:
    | Date
    | string
    | null,

  errorCode: string,
) {
  if (value === null) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(
          value,
        );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      errorCode,
    );
  }

  return date.toISOString();
}

/*
 * Identidad operacional, no identidad
 * persistente.
 *
 * Varias filas ReservationOption pueden
 * pertenecer al mismo grupo visible sin
 * perder sus snapshots individuales.
 */
export function getReservationOptionOperationalGroupKey(
  input:
    ReservationOptionOperationalGroupInput,
) {
  const reservationId =
    requireIdentifier(
      input.reservationId,
      "RESERVATION_OPTION_GROUP_RESERVATION_ID_REQUIRED",
    );

  const reservationOptionId =
    requireIdentifier(
      input.reservationOptionId,
      "RESERVATION_OPTION_GROUP_OPTION_ID_REQUIRED",
    );

  const reservationServiceId =
    normalizeOptionalIdentifier(
      input.reservationServiceId,
    );

  const serviceOptionId =
    normalizeOptionalIdentifier(
      input.serviceOptionId,
    );

  const optionId =
    normalizeOptionalIdentifier(
      input.optionId,
    );

  /*
   * ServiceOption es la identidad más
   * precisa de la configuración vendida.
   *
   * optionId conserva agrupación histórica
   * si ServiceOption fue eliminado.
   *
   * Sin ambas referencias aislamos la fila:
   * nunca agrupamos solamente por nombre.
   */
  const optionIdentity =
    serviceOptionId
      ? [
          "SERVICE_OPTION",
          serviceOptionId,
        ]
      : optionId
        ? [
            "OPTION",
            optionId,
          ]
        : [
            "RESERVATION_OPTION",
            reservationOptionId,
          ];

  const usesReservationInterval =
    input.startAt ===
      null &&
    input.endAt ===
      null;

  const startAt =
    normalizeDate(
      input.startAt,
      "INVALID_RESERVATION_OPTION_GROUP_START_AT",
    );

  const endAt =
    normalizeDate(
      input.endAt,
      "INVALID_RESERVATION_OPTION_GROUP_END_AT",
    );

  return JSON.stringify([
    "RESERVATION_OPTION_OPERATIONAL_GROUP_V1",

    reservationId,

    reservationServiceId,

    optionIdentity,

    usesReservationInterval
      ? "RESERVATION_INTERVAL"
      : "OPTION_INTERVAL",

    startAt,

    endAt,
  ]);
}

export function areReservationOptionsInSameOperationalGroup(
  first:
    ReservationOptionOperationalGroupInput,

  second:
    ReservationOptionOperationalGroupInput,
) {
  return (
    getReservationOptionOperationalGroupKey(
      first,
    ) ===
    getReservationOptionOperationalGroupKey(
      second,
    )
  );
}

export function getReservationOptionResourceRequirementGroupKey({
  operationalGroupKey,

  resourceTypeId,
}: {
  operationalGroupKey:
    string;

  resourceTypeId:
    string;
}) {
  const normalizedOperationalGroupKey =
    requireIdentifier(
      operationalGroupKey,
      "OPTION_RESOURCE_GROUP_KEY_REQUIRED",
    );

  const normalizedResourceTypeId =
    requireIdentifier(
      resourceTypeId,
      "OPTION_RESOURCE_GROUP_TYPE_ID_REQUIRED",
    );

  return JSON.stringify([
    "RESERVATION_OPTION_RESOURCE_GROUP_V1",

    normalizedOperationalGroupKey,

    normalizedResourceTypeId,
  ]);
}

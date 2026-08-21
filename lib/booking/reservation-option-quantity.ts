export type ResolveReservationOptionActiveQuantityInput = {
  includedQuantity: number;
  optionalQuantity: number;
  removedOptionalQuantity: number;
};

export type ReservationOptionActiveQuantity = {
  /*
   * Snapshot contractual original.
   */
  includedQuantity: number;

  originalOptionalQuantity: number;

  removedOptionalQuantity: number;

  originalQuantity: number;

  /*
   * Estado contractual actualmente activo.
   */
  activeOptionalQuantity: number;

  activeQuantity: number;

  isFullyRemoved: boolean;
};

function assertNonNegativeInteger(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      errorCode,
    );
  }
}

/*
 * Resuelve la cantidad ACTIVA de un
 * ReservationOption sin destruir su
 * snapshot contractual original.
 *
 * Ejemplo:
 *
 * includedQuantity        = 1
 * optionalQuantity        = 3
 * removedOptionalQuantity = 1
 *
 * originalQuantity        = 4
 * activeOptionalQuantity  = 2
 * activeQuantity          = 3
 *
 * IMPORTANTE:
 *
 * removedOptionalQuantity solamente
 * puede descontar la parte opcional.
 *
 * La cantidad incluida nunca se elimina
 * mediante OPTION_REMOVED.
 */
export function resolveReservationOptionActiveQuantity({
  includedQuantity,
  optionalQuantity,
  removedOptionalQuantity,
}: ResolveReservationOptionActiveQuantityInput): ReservationOptionActiveQuantity {
  assertNonNegativeInteger(
    includedQuantity,
    "INVALID_RESERVATION_OPTION_INCLUDED_QUANTITY",
  );

  assertNonNegativeInteger(
    optionalQuantity,
    "INVALID_RESERVATION_OPTION_OPTIONAL_QUANTITY",
  );

  assertNonNegativeInteger(
    removedOptionalQuantity,
    "INVALID_RESERVATION_OPTION_REMOVED_QUANTITY",
  );

  const originalQuantity =
    includedQuantity +
    optionalQuantity;

  /*
   * Un ReservationOption persistido debe
   * representar alguna cantidad original.
   *
   * Sí permitimos activeQuantity = 0:
   * ocurre cuando una Option puramente
   * opcional fue retirada por completo.
   */
  if (
    originalQuantity <
    1
  ) {
    throw new Error(
      "RESERVATION_OPTION_ORIGINAL_QUANTITY_REQUIRED",
    );
  }

  if (
    removedOptionalQuantity >
    optionalQuantity
  ) {
    throw new Error(
      "RESERVATION_OPTION_REMOVED_QUANTITY_EXCEEDS_OPTIONAL",
    );
  }

  const activeOptionalQuantity =
    optionalQuantity -
    removedOptionalQuantity;

  const activeQuantity =
    includedQuantity +
    activeOptionalQuantity;

  /*
   * isFullyRemoved significa que la línea
   * ya no representa ninguna prestación
   * activa.
   *
   * Una Option con includedQuantity > 0
   * nunca queda fully removed mediante
   * este flujo, aunque se retiren todos
   * sus adicionales.
   */
  const isFullyRemoved =
    activeQuantity ===
    0;

  return {
    includedQuantity,

    originalOptionalQuantity:
      optionalQuantity,

    removedOptionalQuantity,

    originalQuantity,

    activeOptionalQuantity,

    activeQuantity,

    isFullyRemoved,
  };
}
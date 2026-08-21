import {
  calculateOptionPrice,
  type OptionPricingBase,
  type OptionPricingFrequency,
} from "@/lib/booking/option-pricing";

import {
  resolveReservationOptionActiveQuantity,
} from "@/lib/booking/reservation-option-quantity";

import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

export type ResolveReservationOptionRemovalInput = {
  includedQuantity: number;

  /*
   * Snapshot contractual original.
   */
  optionalQuantity: number;

  /*
   * Cantidad opcional ya retirada
   * anteriormente.
   */
  removedOptionalQuantity: number;

  /*
   * Nueva cantidad adicional que se
   * desea retirar en esta operación.
   */
  removeOptionalQuantity: number;

  /*
   * Snapshot histórico de precio.
   *
   * Nunca consultamos ServiceOption
   * actual para recalcular un contrato
   * existente.
   */
  unitPrice:
    | number
    | string;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  /*
   * Unidades ya vigentes para esta línea.
   *
   * OPTION_REMOVED no cambia tiempo:
   * solamente cambia cantidad.
   */
  billingUnits:
    number;

  /*
   * Subtotal ACTUAL persistido antes
   * de esta operación.
   */
  currentSubtotal:
    number;
};

export type ReservationOptionRemovalResult = {
  includedQuantity: number;

  originalOptionalQuantity: number;

  removedOptionalQuantityBefore: number;
  removedOptionalQuantityAfter: number;

  activeOptionalQuantityBefore: number;
  activeOptionalQuantityAfter: number;

  activeQuantityBefore: number;
  activeQuantityAfter: number;

  removeOptionalQuantity: number;

  unitPrice: number;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  billingUnits: number;

  oldSubtotal: number;
  newSubtotal: number;

  priceReduction: number;

  isFullyRemovedBefore: boolean;
  isFullyRemovedAfter: boolean;
};

function assertPositiveInteger(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isInteger(
      value,
    ) ||
    value < 1
  ) {
    throw new Error(
      errorCode,
    );
  }
}

function normalizeBillingUnits(
  value: number,
) {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      "INVALID_RESERVATION_OPTION_REMOVAL_BILLING_UNITS",
    );
  }

  /*
   * ReservationOption.billingUnits está
   * persistido como Decimal(10,2).
   *
   * Trabajamos con la misma precisión
   * contractual.
   */
  return Math.round(
    (
      value +
      Number.EPSILON
    ) *
      100,
  ) / 100;
}

/*
 * Calcula una reducción de cantidad
 * opcional sobre un ReservationOption
 * existente.
 *
 * Este helper:
 *
 * - NO modifica el snapshot original
 * - NO toca inventario
 * - NO crea Refund
 * - NO modifica Reservation
 * - NO consulta ServiceOption
 *
 * Su única responsabilidad es resolver
 * el nuevo estado contractual de esta
 * línea y su impacto monetario.
 */
export function resolveReservationOptionRemoval({
  includedQuantity,

  optionalQuantity,
  removedOptionalQuantity,

  removeOptionalQuantity,

  unitPrice,

  pricingBase,
  pricingFrequency,

  billingUnits,

  currentSubtotal,
}: ResolveReservationOptionRemovalInput): ReservationOptionRemovalResult {
  assertPositiveInteger(
    removeOptionalQuantity,
    "INVALID_RESERVATION_OPTION_REMOVE_QUANTITY",
  );

  const before =
    resolveReservationOptionActiveQuantity({
      includedQuantity,

      optionalQuantity,

      removedOptionalQuantity,
    });

  /*
   * Una línea puramente opcional ya
   * retirada completamente no puede
   * volver a retirarse.
   */
  if (
    before
      .activeOptionalQuantity <
    1
  ) {
    throw new Error(
      "RESERVATION_OPTION_HAS_NO_ACTIVE_OPTIONAL_QUANTITY",
    );
  }

  if (
    removeOptionalQuantity >
    before
      .activeOptionalQuantity
  ) {
    throw new Error(
      "RESERVATION_OPTION_REMOVE_QUANTITY_EXCEEDS_ACTIVE",
    );
  }

  const removedOptionalQuantityAfter =
    removedOptionalQuantity +
    removeOptionalQuantity;

  const after =
    resolveReservationOptionActiveQuantity({
      includedQuantity,

      optionalQuantity,

      removedOptionalQuantity:
        removedOptionalQuantityAfter,
    });

  const normalizedBillingUnits =
    normalizeBillingUnits(
      billingUnits,
    );

  const oldSubtotalCents =
    toCents(
      currentSubtotal,
    );

  if (
    oldSubtotalCents <
    0
  ) {
    throw new Error(
      "INVALID_RESERVATION_OPTION_CURRENT_SUBTOTAL",
    );
  }

  /*
   * Si queda alguna prestación activa,
   * reutilizamos exactamente la misma
   * regla de precio del Core.
   *
   * Si activeQuantity queda en cero,
   * calculateOptionPrice no aplica porque
   * correctamente rechaza una Option nueva
   * sin cantidad. Aquí estamos retirando
   * una línea histórica existente, por lo
   * que su nuevo subtotal simplemente es 0.
   */
  const newPricing =
    after.isFullyRemoved
      ? null
      : calculateOptionPrice({
          includedQuantity:
            after.includedQuantity,

          optionalQuantity:
            after.activeOptionalQuantity,

          unitPrice,

          pricingBase,

          pricingFrequency,

          billingUnits:
            normalizedBillingUnits,
        });

  const newSubtotalCents =
    toCents(
      newPricing
        ?.subtotal ??
        0,
    );

  /*
   * Retirar cantidad nunca puede aumentar
   * el valor contractual de esta línea.
   *
   * Si ocurre, existe inconsistencia entre
   * el subtotal persistido y su snapshot de
   * pricing, y preferimos detener la operación
   * antes que generar un ajuste incorrecto.
   */
  if (
    newSubtotalCents >
    oldSubtotalCents
  ) {
    throw new Error(
      "RESERVATION_OPTION_REMOVAL_INCREASES_SUBTOTAL",
    );
  }

  const priceReductionCents =
    oldSubtotalCents -
    newSubtotalCents;

  /*
   * calculateOptionPrice ya normaliza el
   * precio monetario. Lo reutilizamos para
   * exponer unitPrice de forma consistente.
   *
   * En una línea totalmente retirada usamos
   * el estado previo, que necesariamente
   * tenía cantidad opcional activa.
   */
  const referencePricing =
    newPricing ??
    calculateOptionPrice({
      includedQuantity:
        before.includedQuantity,

      optionalQuantity:
        before.activeOptionalQuantity,

      unitPrice,

      pricingBase,

      pricingFrequency,

      billingUnits:
        normalizedBillingUnits,
    });

  return {
    includedQuantity:
      before.includedQuantity,

    originalOptionalQuantity:
      before.originalOptionalQuantity,

    removedOptionalQuantityBefore:
      before.removedOptionalQuantity,

    removedOptionalQuantityAfter,

    activeOptionalQuantityBefore:
      before.activeOptionalQuantity,

    activeOptionalQuantityAfter:
      after.activeOptionalQuantity,

    activeQuantityBefore:
      before.activeQuantity,

    activeQuantityAfter:
      after.activeQuantity,

    removeOptionalQuantity,

    unitPrice:
      referencePricing.unitPrice,

    pricingBase,

    pricingFrequency,

    billingUnits:
      normalizedBillingUnits,

    oldSubtotal:
      fromCents(
        oldSubtotalCents,
      ),

    newSubtotal:
      fromCents(
        newSubtotalCents,
      ),

    priceReduction:
      fromCents(
        priceReductionCents,
      ),

    isFullyRemovedBefore:
      before.isFullyRemoved,

    isFullyRemovedAfter:
      after.isFullyRemoved,
  };
}
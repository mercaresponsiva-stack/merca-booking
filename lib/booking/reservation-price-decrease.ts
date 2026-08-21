import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

export type ResolveReservationPriceDecreaseInput = {
  /*
   * Valores contractuales actuales de
   * Reservation antes del cambio.
   */
  currentSubtotal: number;
  currentTotal: number;

  /*
   * Reducción contractual provocada por
   * una operación concreta.
   *
   * El Core no sabe si provino de:
   *
   * - OPTION_REMOVED
   * - PRICE_ADJUSTMENT
   * - descuento administrativo
   * - otra vertical futura
   */
  priceReduction: number;

  /*
   * Dinero efectivamente pagado neto
   * antes de crear cualquier Refund
   * nuevo por este ajuste.
   */
  netPaid: number;
};

export type ReservationPriceDecreaseResult = {
  currentSubtotal: number;
  currentTotal: number;

  priceReduction: number;

  newSubtotal: number;
  newTotal: number;

  netPaid: number;

  balance: number;

  /*
   * Dinero pagado que queda por encima
   * del nuevo valor contractual.
   *
   * Este helper NO crea Refund.
   */
  overpayment: number;
};

export function resolveReservationPriceDecrease({
  currentSubtotal,
  currentTotal,

  priceReduction,

  netPaid,
}: ResolveReservationPriceDecreaseInput): ReservationPriceDecreaseResult {
  const currentSubtotalCents =
    toCents(
      currentSubtotal,
    );

  const currentTotalCents =
    toCents(
      currentTotal,
    );

  const priceReductionCents =
    toCents(
      priceReduction,
    );

  const netPaidCents =
    toCents(
      netPaid,
    );

  if (
    currentSubtotalCents < 0 ||
    currentTotalCents < 0 ||
    priceReductionCents < 0 ||
    netPaidCents < 0
  ) {
    throw new Error(
      "INVALID_RESERVATION_PRICE_DECREASE_VALUES",
    );
  }

  /*
   * La reducción se aplica tanto al
   * subtotal como al total.
   *
   * No reconstruimos total desde subtotal.
   *
   * Así preservamos cualquier diferencia
   * contractual que pudiera existir:
   *
   * subtotal = 280
   * total    = 300
   *
   * reducción = 24
   *
   * nuevo subtotal = 256
   * nuevo total    = 276
   *
   * delta histórico = 20 permanece.
   */
  if (
    priceReductionCents >
      currentSubtotalCents ||
    priceReductionCents >
      currentTotalCents
  ) {
    throw new Error(
      "RESERVATION_PRICE_DECREASE_EXCEEDS_CONTRACT",
    );
  }

  const newSubtotalCents =
    currentSubtotalCents -
    priceReductionCents;

  const newTotalCents =
    currentTotalCents -
    priceReductionCents;

  const overpaymentCents =
    Math.max(
      netPaidCents -
        newTotalCents,

      0,
    );

  const balanceCents =
    Math.max(
      newTotalCents -
        netPaidCents,

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

    priceReduction:
      fromCents(
        priceReductionCents,
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

    overpayment:
      fromCents(
        overpaymentCents,
      ),
  };
}
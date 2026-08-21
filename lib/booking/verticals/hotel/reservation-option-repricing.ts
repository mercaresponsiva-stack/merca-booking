import {
  calculateOptionPrice,
  type OptionPricingBase,
  type OptionPricingFrequency,
} from "@/lib/booking/option-pricing";

import {
  resolveHotelOptionBillingUnits,
} from "@/lib/booking/verticals/hotel/option-pricing";

export type ExistingHotelReservationOptionForRepricing = {
  id: string;

  includedQuantity: number;
  optionalQuantity: number;

  unitPrice:
    | number
    | string;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  /*
   * null/null:
   * hereda el intervalo principal
   * de Reservation.
   *
   * Date/Date:
   * conserva un intervalo propio.
   */
  startAt:
    Date | null;

  endAt:
    Date | null;
};

export type RepricedHotelReservationOption = {
  id: string;

  quantity: number;

  includedQuantity: number;
  optionalQuantity: number;

  billingUnits: number;

  subtotal: number;
};

type RepriceHotelReservationOptionsInput = {
  checkIn: string;
  checkOut: string;

  timezone: string;

  options:
    ExistingHotelReservationOptionForRepricing[];
};

function normalizeMoney(
  value: number,
) {
  return Math.round(
    (
      value +
      Number.EPSILON
    ) *
      100,
  ) / 100;
}

/*
 * Recotiza ReservationOption históricos
 * al cambiar el intervalo de una reserva
 * hotelera.
 *
 * IMPORTANTE:
 *
 * NO consulta ServiceOption.
 *
 * Por tanto NO toma:
 *
 * - precio actual
 * - cantidades incluidas actuales
 * - frecuencia actual
 * - configuración actual
 *
 * Todo eso pertenece al snapshot de
 * ReservationOption.
 */
export function repriceHotelReservationOptionsForStay({
  checkIn,
  checkOut,

  timezone,

  options,
}: RepriceHotelReservationOptionsInput) {
  const items:
    RepricedHotelReservationOption[] =
    options.map(
      (option) => {
        const hasStart =
          option.startAt !==
          null;

        const hasEnd =
          option.endAt !==
          null;

        if (
          hasStart !==
          hasEnd
        ) {
          throw new Error(
            "RESERVATION_OPTION_INTERVAL_INCOMPLETE",
          );
        }

        const billingUnits =
          resolveHotelOptionBillingUnits({
            pricingFrequency:
              option.pricingFrequency,

            checkIn,
            checkOut,

            optionStartAt:
              option.startAt,

            optionEndAt:
              option.endAt,

            timezone,
          });

        const pricing =
          calculateOptionPrice({
            includedQuantity:
              option.includedQuantity,

            optionalQuantity:
              option.optionalQuantity,

            unitPrice:
              option.unitPrice,

            pricingBase:
              option.pricingBase,

            pricingFrequency:
              option.pricingFrequency,

            billingUnits,
          });

        return {
          id:
            option.id,

          quantity:
            pricing.quantity,

          includedQuantity:
            pricing.includedQuantity,

          optionalQuantity:
            pricing.optionalQuantity,

          billingUnits:
            pricing.billingUnits,

          subtotal:
            pricing.subtotal,
        };
      },
    );

  const subtotal =
    normalizeMoney(
      items.reduce(
        (
          total,
          item,
        ) =>
          total +
          item.subtotal,

        0,
      ),
    );

  return {
    items,

    subtotal,
  };
}

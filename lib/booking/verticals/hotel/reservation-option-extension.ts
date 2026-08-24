import {
  isValidDateOnly,
} from "@/lib/booking/datetime";

import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

import {
  calculateOptionPrice,
  type OptionPricingBase,
  type OptionPricingFrequency,
} from "@/lib/booking/option-pricing";

import {
  resolveReservationOptionActiveQuantity,
} from "@/lib/booking/reservation-option-quantity";

import {
  resolveHotelOptionBillingUnits,
} from "@/lib/booking/verticals/hotel/option-pricing";

import {
  calculateHotelNights,
} from "@/lib/booking/verticals/hotel/pricing";

export type ExistingHotelReservationOptionForExtension = {
  id:
    string;

  includedQuantity:
    number;

  optionalQuantity:
    number;

  removedOptionalQuantity:
    number;

  unitPrice:
    number | string;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  billingUnits:
    number | string;

  subtotal:
    number | string;

  startAt:
    Date | null;

  endAt:
    Date | null;
};

export type ExtendedHotelReservationOption = {
  id:
    string;

  quantity:
    number;

  includedQuantity:
    number;

  optionalQuantity:
    number;

  currentStayBillingUnits:
    number;

  extendedStayBillingUnits:
    number;

  previousBillingUnits:
    number;

  additionalBillingUnits:
    number;

  newBillingUnits:
    number;

  previousSubtotal:
    number;

  additionalSubtotal:
    number;

  newSubtotal:
    number;
};

type CalculateHotelReservationOptionExtensionInput = {
  currentCheckIn:
    string;

  currentCheckOut:
    string;

  newCheckOut:
    string;

  timezone:
    string;

  options:
    ExistingHotelReservationOptionForExtension[];
};

function normalizeNonNegativeNumber(
  value:
    number | string,

  errorCode:
    string,
) {
  const normalized =
    typeof value ===
    "number"
      ? value
      : Number(
          value,
        );

  if (
    !Number.isFinite(
      normalized,
    ) ||
    normalized <
      0
  ) {
    throw new Error(
      errorCode,
    );
  }

  return normalized;
}

function normalizeBillingUnitHundredths(
  value:
    number | string,
) {
  const normalized =
    normalizeNonNegativeNumber(
      value,
      "INVALID_STAY_EXTENSION_OPTION_BILLING_UNITS",
    );

  const hundredths =
    Math.round(
      (
        normalized +
        Number.EPSILON
      ) *
        100,
    );

  if (
    !Number.isSafeInteger(
      hundredths,
    )
  ) {
    throw new Error(
      "STAY_EXTENSION_OPTION_CALCULATION_OVERFLOW",
    );
  }

  return hundredths;
}

function normalizeMoneyCents(
  value:
    number | string,
) {
  const normalized =
    normalizeNonNegativeNumber(
      value,
      "INVALID_STAY_EXTENSION_OPTION_SUBTOTAL",
    );

  const cents =
    toCents(
      normalized,
    );

  if (
    !Number.isSafeInteger(
      cents,
    )
  ) {
    throw new Error(
      "STAY_EXTENSION_OPTION_CALCULATION_OVERFLOW",
    );
  }

  return cents;
}

function addSafeIntegers(
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
      "STAY_EXTENSION_OPTION_CALCULATION_OVERFLOW",
    );
  }

  return result;
}

/*
 * Calcula únicamente el incremento de los
 * complementos al ampliar una estancia.
 *
 * No reemplaza el contrato histórico:
 *
 * newBillingUnits =
 * persistedBillingUnits + addedUnits
 *
 * newSubtotal =
 * persistedSubtotal + addedCharge
 */
export function calculateHotelReservationOptionExtension({
  currentCheckIn,
  currentCheckOut,
  newCheckOut,

  timezone,

  options,
}: CalculateHotelReservationOptionExtensionInput) {
  for (
    const dateOnly of [
      currentCheckIn,
      currentCheckOut,
      newCheckOut,
    ]
  ) {
    if (
      !isValidDateOnly(
        dateOnly,
      )
    ) {
      throw new Error(
        "INVALID_STAY_EXTENSION_DATE_ONLY",
      );
    }
  }

  const previousNights =
    calculateHotelNights(
      currentCheckIn,
      currentCheckOut,
    );

  const newNights =
    calculateHotelNights(
      currentCheckIn,
      newCheckOut,
    );

  if (
    newNights <=
    previousNights
  ) {
    throw new Error(
      "STAY_EXTENSION_NIGHTS_REQUIRED",
    );
  }

  const seenOptionIds =
    new Set<string>();

  const items:
    ExtendedHotelReservationOption[] =
    [];

  let previousSubtotalCents =
    0;

  let additionalSubtotalCents =
    0;

  let newSubtotalCents =
    0;

  for (
    const option of
    options
  ) {
    if (
      seenOptionIds.has(
        option.id,
      )
    ) {
      throw new Error(
        "DUPLICATE_STAY_EXTENSION_OPTION",
      );
    }

    seenOptionIds.add(
      option.id,
    );

    const activeQuantity =
      resolveReservationOptionActiveQuantity({
        includedQuantity:
          option.includedQuantity,

        optionalQuantity:
          option.optionalQuantity,

        removedOptionalQuantity:
          option.removedOptionalQuantity,
      });

    /*
     * Estas unidades resueltas representan
     * únicamente la diferencia temporal.
     *
     * Las unidades persistidas pueden ser un
     * snapshot histórico distinto y por eso
     * nunca se reemplazan directamente.
     */
    const currentStayBillingUnitHundredths =
      normalizeBillingUnitHundredths(
        resolveHotelOptionBillingUnits({
          pricingFrequency:
            option.pricingFrequency,

          checkIn:
            currentCheckIn,

          checkOut:
            currentCheckOut,

          optionStartAt:
            option.startAt,

          optionEndAt:
            option.endAt,

          timezone,
        }),
      );

    const extendedStayBillingUnitHundredths =
      normalizeBillingUnitHundredths(
        resolveHotelOptionBillingUnits({
          pricingFrequency:
            option.pricingFrequency,

          checkIn:
            currentCheckIn,

          checkOut:
            newCheckOut,

          optionStartAt:
            option.startAt,

          optionEndAt:
            option.endAt,

          timezone,
        }),
      );

    if (
      extendedStayBillingUnitHundredths <
      currentStayBillingUnitHundredths
    ) {
      throw new Error(
        "STAY_EXTENSION_OPTION_BILLING_UNITS_DECREASED",
      );
    }

    const resolvedAdditionalBillingUnitHundredths =
      extendedStayBillingUnitHundredths -
      currentStayBillingUnitHundredths;

    /*
     * Una línea completamente retirada ya no
     * presta servicio y no acumula nuevas
     * unidades, aunque su intervalo heredado
     * sea más largo.
     */
    const additionalBillingUnitHundredths =
      activeQuantity.isFullyRemoved
        ? 0
        : resolvedAdditionalBillingUnitHundredths;

    const previousBillingUnitHundredths =
      normalizeBillingUnitHundredths(
        option.billingUnits,
      );

    const newBillingUnitHundredths =
      addSafeIntegers(
        previousBillingUnitHundredths,
        additionalBillingUnitHundredths,
      );

    const optionPreviousSubtotalCents =
      normalizeMoneyCents(
        option.subtotal,
      );

    let optionAdditionalSubtotalCents =
      0;

    if (
      additionalBillingUnitHundredths >
      0
    ) {
      const additionalPricing =
        calculateOptionPrice({
          includedQuantity:
            activeQuantity.includedQuantity,

          optionalQuantity:
            activeQuantity.activeOptionalQuantity,

          unitPrice:
            option.unitPrice,

          pricingBase:
            option.pricingBase,

          pricingFrequency:
            option.pricingFrequency,

          billingUnits:
            additionalBillingUnitHundredths /
            100,
        });

      optionAdditionalSubtotalCents =
        normalizeMoneyCents(
          additionalPricing.subtotal,
        );
    }

    const optionNewSubtotalCents =
      addSafeIntegers(
        optionPreviousSubtotalCents,
        optionAdditionalSubtotalCents,
      );

    previousSubtotalCents =
      addSafeIntegers(
        previousSubtotalCents,
        optionPreviousSubtotalCents,
      );

    additionalSubtotalCents =
      addSafeIntegers(
        additionalSubtotalCents,
        optionAdditionalSubtotalCents,
      );

    newSubtotalCents =
      addSafeIntegers(
        newSubtotalCents,
        optionNewSubtotalCents,
      );

    items.push({
      id:
        option.id,

      quantity:
        activeQuantity.activeQuantity,

      includedQuantity:
        activeQuantity.includedQuantity,

      optionalQuantity:
        activeQuantity.activeOptionalQuantity,

      currentStayBillingUnits:
        currentStayBillingUnitHundredths /
        100,

      extendedStayBillingUnits:
        extendedStayBillingUnitHundredths /
        100,

      previousBillingUnits:
        previousBillingUnitHundredths /
        100,

      additionalBillingUnits:
        additionalBillingUnitHundredths /
        100,

      newBillingUnits:
        newBillingUnitHundredths /
        100,

      previousSubtotal:
        fromCents(
          optionPreviousSubtotalCents,
        ),

      additionalSubtotal:
        fromCents(
          optionAdditionalSubtotalCents,
        ),

      newSubtotal:
        fromCents(
          optionNewSubtotalCents,
        ),
    });
  }

  return {
    previousNights,

    additionalNights:
      newNights -
      previousNights,

    newNights,

    previousSubtotal:
      fromCents(
        previousSubtotalCents,
      ),

    additionalSubtotal:
      fromCents(
        additionalSubtotalCents,
      ),

    newSubtotal:
      fromCents(
        newSubtotalCents,
      ),

    items,
  };
}
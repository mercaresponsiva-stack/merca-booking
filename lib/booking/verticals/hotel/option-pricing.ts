import {
  type OptionPricingFrequency,
} from "@/lib/booking/option-pricing";

import {
  calculateHotelNights,
} from "@/lib/booking/verticals/hotel/pricing";

type ResolveHotelOptionBillingUnitsInput = {
  pricingFrequency:
    OptionPricingFrequency;

  /*
   * Intervalo general de la reserva
   * expresado como fechas Hotel.
   */
  checkIn: string;
  checkOut: string;

  /*
   * Intervalo propio ya resuelto por
   * el servidor.
   *
   * Si existe, la opción puede ocupar
   * solamente una parte de la reserva.
   */
  optionStartAt?: Date | null;
  optionEndAt?: Date | null;

  /*
   * Necesario para interpretar qué día
   * calendario corresponde a un Date
   * cuando calculamos PER_NIGHT/PER_DAY.
   */
  timezone?: string;
};

function validateOwnInterval(
  startAt:
    Date | null | undefined,

  endAt:
    Date | null | undefined,
) {
  const hasStart =
    startAt !== undefined &&
    startAt !== null;

  const hasEnd =
    endAt !== undefined &&
    endAt !== null;

  if (
    hasStart !== hasEnd
  ) {
    throw new Error(
      "OPTION_INTERVAL_INCOMPLETE",
    );
  }

  if (
    !hasStart ||
    !hasEnd
  ) {
    return null;
  }

  if (
    Number.isNaN(
      startAt!.getTime(),
    ) ||
    Number.isNaN(
      endAt!.getTime(),
    ) ||
    endAt! <= startAt!
  ) {
    throw new Error(
      "INVALID_OPTION_INTERVAL",
    );
  }

  return {
    startAt:
      startAt!,

    endAt:
      endAt!,
  };
}

function dateOnlyInTimezone(
  date: Date,
  timezone: string,
) {
  const parts =
    new Intl.DateTimeFormat(
      "en-US",
      {
        timeZone:
          timezone,

        year:
          "numeric",

        month:
          "2-digit",

        day:
          "2-digit",
      },
    ).formatToParts(
      date,
    );

  const year =
    parts.find(
      (part) =>
        part.type ===
        "year",
    )?.value;

  const month =
    parts.find(
      (part) =>
        part.type ===
        "month",
    )?.value;

  const day =
    parts.find(
      (part) =>
        part.type ===
        "day",
    )?.value;

  if (
    !year ||
    !month ||
    !day
  ) {
    throw new Error(
      "INVALID_OPTION_TIMEZONE_DATE",
    );
  }

  return `${year}-${month}-${day}`;
}

export function resolveHotelOptionBillingUnits({
  pricingFrequency,

  checkIn,
  checkOut,

  optionStartAt,
  optionEndAt,

  timezone,
}: ResolveHotelOptionBillingUnitsInput): number {
  const ownInterval =
    validateOwnInterval(
      optionStartAt,
      optionEndAt,
    );

  switch (
    pricingFrequency
  ) {
    case "ONCE":
      return 1;

    case "PER_NIGHT":
    case "PER_DAY": {
      /*
       * Sin intervalo propio:
       * la opción sigue toda la estancia.
       */
      if (!ownInterval) {
        return calculateHotelNights(
          checkIn,
          checkOut,
        );
      }

      if (!timezone) {
        throw new Error(
          "HOTEL_OPTION_TIMEZONE_REQUIRED",
        );
      }

      const optionCheckIn =
        dateOnlyInTimezone(
          ownInterval.startAt,
          timezone,
        );

      const optionCheckOut =
        dateOnlyInTimezone(
          ownInterval.endAt,
          timezone,
        );

      return calculateHotelNights(
        optionCheckIn,
        optionCheckOut,
      );
    }

    case "PER_HOUR": {
      /*
       * Para precios por hora no
       * aceptamos billingUnits calculadas
       * por el frontend.
       *
       * Las horas salen exclusivamente
       * del intervalo real.
       */
      if (!ownInterval) {
        throw new Error(
          "HOTEL_OPTION_HOURLY_INTERVAL_REQUIRED",
        );
      }

      const hours =
        (
          ownInterval
            .endAt
            .getTime() -
          ownInterval
            .startAt
            .getTime()
        ) /
        (
          60 *
          60 *
          1000
        );

      if (
        !Number.isFinite(
          hours,
        ) ||
        hours <= 0
      ) {
        throw new Error(
          "INVALID_OPTION_BILLING_UNITS",
        );
      }

      return hours;
    }
  }
}

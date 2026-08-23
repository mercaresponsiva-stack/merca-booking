import {
  calculateOptionPrice,
  type OptionPricingBase,
  type OptionPricingFrequency,
} from "@/lib/booking/option-pricing";

import {
  resolveHotelOptionBillingUnits,
} from "@/lib/booking/verticals/hotel/option-pricing";

import { prisma } from "@/lib/prisma";

export type HotelPostBookingOptionSelection = {
  serviceOptionId: string;

  /*
   * Es un incremento.
   *
   * No representa la cantidad total
   * histórica de la Reservation.
   */
  optionalQuantity: number;

  /*
   * null/null:
   * hereda Reservation.startAt/endAt.
   *
   * Date/Date:
   * la nueva Option tiene intervalo propio.
   */
  startAt?: Date | null;
  endAt?: Date | null;
};

export type HotelPostBookingOptionQuoteItem = {
  optionId: string;
  serviceOptionId: string;

  name: string;
  description: string | null;

  /*
   * Un agregado post-booking nunca vuelve
   * a generar la cantidad incluida del
   * contrato original.
   */
  quantity: number;
  includedQuantity: 0;
  optionalQuantity: number;

  /*
   * Útiles para auditoría y para demostrar
   * que los límites se validaron contra
   * toda la Reservation.
   */
  existingOptionalQuantity: number;
  accumulatedOptionalQuantity: number;

  unitPrice: number;

  pricingBase:
    OptionPricingBase;

  pricingFrequency:
    OptionPricingFrequency;

  billingUnits: number;

  subtotal: number;

  startAt: Date | null;
  endAt: Date | null;

  resourceTypes: {
    resourceTypeId: string;

    requiredQuantity: number;

    /*
     * Solo representa la NUEVA demanda
     * física que estamos agregando.
     *
     * No incluye la demanda histórica,
     * porque esa ya está persistida y será
     * contabilizada por el Core de inventario.
     */
    requiredResources: number;
  }[];
};

export type HotelPostBookingOptionsQuote = {
  businessId: string;
  serviceId: string;
  reservationId: string;

  checkIn: string;
  checkOut: string;

  guests: number;

  items:
    HotelPostBookingOptionQuoteItem[];

  subtotal: number;
};

export type HotelPostBookingOptionQuoteDb =
  Pick<
    typeof prisma,
    "service" |
    "reservationOption"
  >;

type QuoteHotelPostBookingOptionsInput = {
  businessId: string;
  serviceId: string;
  reservationId: string;

  checkIn: string;
  checkOut: string;

  guests: number;

  selections:
    HotelPostBookingOptionSelection[];

  db?: HotelPostBookingOptionQuoteDb;
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

function normalizeOptionInterval(
  startAt:
    Date | null | undefined,

  endAt:
    Date | null | undefined,
) {
  const hasStart =
    startAt !==
      undefined &&
    startAt !==
      null;

  const hasEnd =
    endAt !==
      undefined &&
    endAt !==
      null;

  if (
    hasStart !==
    hasEnd
  ) {
    throw new Error(
      "OPTION_INTERVAL_INCOMPLETE",
    );
  }

  if (
    !hasStart ||
    !hasEnd
  ) {
    return {
      startAt:
        null,

      endAt:
        null,
    };
  }

  if (
    Number.isNaN(
      startAt!.getTime(),
    ) ||
    Number.isNaN(
      endAt!.getTime(),
    ) ||
    endAt! <=
      startAt!
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

export async function quoteHotelPostBookingOptions({
  businessId,
  serviceId,
  reservationId,

  checkIn,
  checkOut,

  guests,

  selections,

  db = prisma,
}: QuoteHotelPostBookingOptionsInput): Promise<HotelPostBookingOptionsQuote> {
  assertPositiveInteger(
    guests,
    "INVALID_GUEST_COUNT",
  );

  if (
    !Array.isArray(
      selections,
    ) ||
    selections.length <
      1
  ) {
    throw new Error(
      "OPTION_SELECTION_REQUIRED",
    );
  }

  /*
   * Mantenemos la misma regla del booking
   * inicial:
   *
   * una configuración aparece una sola vez
   * por operación.
   *
   * Si se desea añadir de nuevo más adelante,
   * una nueva llamada creará otro snapshot.
   */
  const selectionIds =
    selections.map(
      (selection) =>
        selection.serviceOptionId,
    );

  if (
    new Set(
      selectionIds,
    ).size !==
    selectionIds.length
  ) {
    throw new Error(
      "DUPLICATE_OPTION_SELECTION",
    );
  }

  for (
    const selection of
    selections
  ) {
    assertPositiveInteger(
      selection.optionalQuantity,
      "INVALID_OPTIONAL_QUANTITY",
    );

    normalizeOptionInterval(
      selection.startAt,
      selection.endAt,
    );
  }

  /*
   * Cargamos la configuración ACTUAL.
   *
   * El nuevo snapshot contractual se
   * construirá usando estos valores.
   *
   * Los snapshots existentes no se
   * recalculan ni se modifican.
   */
  const service =
    await db.service.findFirst({
      where: {
        id:
          serviceId,

        businessId,
      },

      select: {
        id:
          true,

        business: {
          select: {
            timezone:
              true,
          },
        },

        options: {
          where: {
            id: {
              in:
                selectionIds,
            },
          },

          select: {
            id:
              true,

            isOptional:
              true,

            minOptionalQuantity:
              true,

            maxOptionalQuantity:
              true,

            price:
              true,

            pricingBase:
              true,

            pricingFrequency:
              true,

            availableAfterBooking:
              true,

            isActive:
              true,

            option: {
              select: {
                id:
                  true,

                name:
                  true,

                description:
                  true,

                isActive:
                  true,
              },
            },

            resourceTypes: {
              select: {
                resourceTypeId:
                  true,

                requiredQuantity:
                  true,
              },
            },
          },
        },
      },
    });

  if (!service) {
    throw new Error(
      "SERVICE_NOT_FOUND",
    );
  }

  const serviceOptionById =
    new Map(
      service.options.map(
        (
          serviceOption,
        ) => [
          serviceOption.id,
          serviceOption,
        ],
      ),
    );

  /*
   * Primero comprobamos toda la
   * configuración.
   *
   * Así ninguna selección inválida queda
   * silenciosamente ignorada.
   */
  for (
    const selection of
    selections
  ) {
    const serviceOption =
      serviceOptionById.get(
        selection
          .serviceOptionId,
      );

    if (
      !serviceOption
    ) {
      throw new Error(
        "SERVICE_OPTION_NOT_FOUND",
      );
    }

    if (
      !serviceOption.isActive ||
      !serviceOption.option
        .isActive
    ) {
      throw new Error(
        "SERVICE_OPTION_NOT_ACTIVE",
      );
    }

    if (
      !serviceOption.isOptional
    ) {
      throw new Error(
        "SERVICE_OPTION_NOT_OPTIONAL",
      );
    }

    if (
      !serviceOption
        .availableAfterBooking
    ) {
      throw new Error(
        "SERVICE_OPTION_NOT_AVAILABLE_AFTER_BOOKING",
      );
    }
  }

  /*
   * Los límites se aplican contra toda
   * la cantidad opcional ya seleccionada
   * de cada ServiceOption en esta
   * Reservation.
   *
   * Ejemplo:
   *
   * max = 4
   *
   * snapshot inicial = 2
   * add +1           = acumulado 3
   * add +1           = acumulado 4
   * add +1           = rechazado
   */
  const existingOptions =
    await db.reservationOption.findMany({
      where: {
        reservationId,

        serviceOptionId: {
          in:
            selectionIds,
        },
      },

      select: {
        serviceOptionId:
          true,

        optionalQuantity:
          true,

        removedOptionalQuantity:
          true,
      },
    });

  const existingOptionalByServiceOption =
    new Map<
      string,
      number
    >();

  for (
    const existingOption of
    existingOptions
  ) {
    if (
      !existingOption
        .serviceOptionId
    ) {
      continue;
    }

    const previous =
      existingOptionalByServiceOption.get(
        existingOption
          .serviceOptionId,
      ) ??
      0;

    existingOptionalByServiceOption.set(
      existingOption
        .serviceOptionId,
      previous +
        Math.max(
          existingOption.optionalQuantity -
            existingOption.removedOptionalQuantity,
          0,
        ),
    );
  }

  const items:
    HotelPostBookingOptionQuoteItem[] =
    [];

  for (
    const selection of
    selections
  ) {
    const serviceOption =
      serviceOptionById.get(
        selection
          .serviceOptionId,
      );

    /*
     * Ya fue comprobado arriba.
     */
    if (
      !serviceOption
    ) {
      throw new Error(
        "SERVICE_OPTION_NOT_FOUND",
      );
    }

    const existingOptionalQuantity =
      existingOptionalByServiceOption.get(
        serviceOption.id,
      ) ??
      0;

    const accumulatedOptionalQuantity =
      existingOptionalQuantity +
      selection.optionalQuantity;

    /*
     * min/max describen la cantidad
     * opcional total contratada para
     * esta configuración.
     *
     * Por ello un incremento individual
     * puede ser menor que min si la
     * Reservation acumulada ya satisface
     * el mínimo.
     */
    if (
      accumulatedOptionalQuantity <
      serviceOption
        .minOptionalQuantity
    ) {
      throw new Error(
        "OPTIONAL_QUANTITY_BELOW_MINIMUM",
      );
    }

    if (
      serviceOption
        .maxOptionalQuantity !==
        null &&
      accumulatedOptionalQuantity >
        serviceOption
          .maxOptionalQuantity
    ) {
      throw new Error(
        "OPTIONAL_QUANTITY_ABOVE_MAXIMUM",
      );
    }

    /*
     * PERSON representa personas reales
     * de la Reservation.
     *
     * Aquí también importa la cantidad
     * acumulada, no solamente el nuevo
     * incremento.
     */
    if (
      serviceOption
        .pricingBase ===
        "PERSON" &&
      accumulatedOptionalQuantity >
        guests
    ) {
      throw new Error(
        "OPTION_PERSON_QUANTITY_EXCEEDS_GUESTS",
      );
    }

    const interval =
      normalizeOptionInterval(
        selection.startAt,
        selection.endAt,
      );

    const billingUnits =
      resolveHotelOptionBillingUnits({
        pricingFrequency:
          serviceOption
            .pricingFrequency,

        checkIn,
        checkOut,

        optionStartAt:
          interval.startAt,

        optionEndAt:
          interval.endAt,

        timezone:
          service.business
            .timezone,
      });

    /*
     * MUY IMPORTANTE:
     *
     * El nuevo snapshot representa
     * únicamente lo agregado ahora.
     *
     * No recreamos cantidades incluidas.
     */
    const pricing =
      calculateOptionPrice({
        includedQuantity:
          0,

        optionalQuantity:
          selection
            .optionalQuantity,

        unitPrice:
          serviceOption
            .price
            .toString(),

        pricingBase:
          serviceOption
            .pricingBase,

        pricingFrequency:
          serviceOption
            .pricingFrequency,

        billingUnits,
      });

    const resourceTypes =
      serviceOption
        .resourceTypes
        .map(
          (
            requirement,
          ) => {
            assertPositiveInteger(
              requirement
                .requiredQuantity,
              "INVALID_OPTION_RESOURCE_REQUIREMENT",
            );

            return {
              resourceTypeId:
                requirement
                  .resourceTypeId,

              requiredQuantity:
                requirement
                  .requiredQuantity,

              /*
               * Solo la demanda física
               * añadida en esta operación.
               */
              requiredResources:
                pricing.quantity *
                requirement
                  .requiredQuantity,
            };
          },
        );

    items.push({
      optionId:
        serviceOption.option.id,

      serviceOptionId:
        serviceOption.id,

      name:
        serviceOption.option.name,

      description:
        serviceOption.option
          .description,

      quantity:
        pricing.quantity,

      includedQuantity:
        0,

      optionalQuantity:
        pricing.optionalQuantity,

      existingOptionalQuantity,

      accumulatedOptionalQuantity,

      unitPrice:
        pricing.unitPrice,

      pricingBase:
        pricing.pricingBase,

      pricingFrequency:
        pricing.pricingFrequency,

      billingUnits:
        pricing.billingUnits,

      subtotal:
        pricing.subtotal,

      startAt:
        interval.startAt,

      endAt:
        interval.endAt,

      resourceTypes,
    });
  }

  const subtotal =
    normalizeMoney(
      items.reduce(
        (
          sum,
          item,
        ) =>
          sum +
          item.subtotal,
        0,
      ),
    );

  return {
    businessId,
    serviceId,
    reservationId,

    checkIn,
    checkOut,

    guests,

    items,

    subtotal,
  };
}
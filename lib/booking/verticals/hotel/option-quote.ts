import {
  calculateOptionPrice,
} from "@/lib/booking/option-pricing";

import {
  resolveHotelOptionBillingUnits,
} from "@/lib/booking/verticals/hotel/option-pricing";

import { prisma } from "@/lib/prisma";

export type HotelOptionSelection = {
  /*
   * El cliente identifica la configuración
   * específica del Service, no solamente
   * el BusinessOption global.
   */
  serviceOptionId: string;

  optionalQuantity: number;


  /*
   * Una opción puede ocupar un intervalo
   * distinto al de la reserva.
   *
   * null significa que ReservationOption
   * heredará Reservation.startAt/endAt.
   */
  startAt?: Date | null;
  endAt?: Date | null;
};

export type HotelOptionQuoteItem = {
  optionId: string;
  serviceOptionId: string;

  name: string;
  description: string | null;

  quantity: number;
  includedQuantity: number;
  optionalQuantity: number;

  unitPrice: number;

  pricingBase:
    | "RESERVATION"
    | "QUANTITY"
    | "PERSON";

  pricingFrequency:
    | "ONCE"
    | "PER_NIGHT"
    | "PER_DAY"
    | "PER_HOUR";

  billingUnits: number;

  subtotal: number;

  startAt: Date | null;
  endAt: Date | null;

  resourceTypes: {
    resourceTypeId: string;
    requiredQuantity: number;

    /*
     * Demanda física de esta opción:
     *
     * quantity × requiredQuantity
     */
    requiredResources: number;
  }[];
};

export type HotelServiceOptionsQuote = {
  businessId: string;
  serviceId: string;

  checkIn: string;
  checkOut: string;

  guests: number;

  items:
    HotelOptionQuoteItem[];

  subtotal: number;
};

export type HotelOptionQuoteDb =
  Pick<
    typeof prisma,
    "service"
  >;

type QuoteHotelServiceOptionsInput = {
  businessId: string;
  serviceId: string;

  checkIn: string;
  checkOut: string;

  guests: number;

  selections?:
    HotelOptionSelection[];

  db?: HotelOptionQuoteDb;
};

function assertPositiveInteger(
  value: number,
  errorCode: string,
) {
  if (
    !Number.isInteger(value) ||
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
    (value +
      Number.EPSILON) *
      100,
  ) / 100;
}

function resolveIncludedQuantity(
  input: {
    isIncluded: boolean;

    configuredIncludedQuantity:
      number | null;

    pricingBase:
      | "RESERVATION"
      | "QUANTITY"
      | "PERSON";

    guests: number;
  },
) {
  if (
    !input.isIncluded
  ) {
    return 0;
  }

  if (
    input.configuredIncludedQuantity !==
    null
  ) {
    assertPositiveInteger(
      input.configuredIncludedQuantity,
      "INVALID_INCLUDED_QUANTITY",
    );

    return input
      .configuredIncludedQuantity;
  }

  /*
   * Reglas de cantidad incluida:
   *
   * RESERVATION
   * → 1 incluido.
   *
   * PERSON
   * → uno por huésped.
   *
   * QUANTITY
   * → debe estar configurado
   *   explícitamente.
   */
  switch (
    input.pricingBase
  ) {
    case "RESERVATION":
      return 1;

    case "PERSON":
      return input.guests;

    case "QUANTITY":
      throw new Error(
        "INCLUDED_QUANTITY_REQUIRED",
      );
  }
}

function validateOptionInterval(
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
    return {
      startAt: null,
      endAt: null,
    };
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

export async function quoteHotelServiceOptions({
  businessId,
  serviceId,

  checkIn,
  checkOut,

  guests,

  selections = [],

  db = prisma,
}: QuoteHotelServiceOptionsInput): Promise<HotelServiceOptionsQuote> {
  assertPositiveInteger(
    guests,
    "INVALID_GUEST_COUNT",
  );

  /*
   * Una configuración solo puede
   * aparecer una vez en la selección.
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

  const service =
    await db.service.findFirst({
      where: {
        id:
          serviceId,

        businessId,
      },

      select: {
        id: true,
        name: true,
        isActive:
          true,

        business: {
          select: {
            id: true,
            isActive:
              true,

            timezone:
              true,
          },
        },

        options: {
          select: {
            id: true,

            isIncluded:
              true,

            isOptional:
              true,

            includedQuantity:
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

            availableDuringBooking:
              true,

            isActive:
              true,

            option: {
              select: {
                id: true,
                name: true,
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

  if (
    !service.business
      .isActive
  ) {
    throw new Error(
      "BUSINESS_NOT_ACTIVE",
    );
  }

  if (
    !service.isActive
  ) {
    throw new Error(
      "SERVICE_NOT_ACTIVE",
    );
  }

  const serviceOptionById =
    new Map(
      service.options.map(
        (serviceOption) => [
          serviceOption.id,
          serviceOption,
        ],
      ),
    );

  const selectionById =
    new Map(
      selections.map(
        (selection) => [
          selection.serviceOptionId,
          selection,
        ],
      ),
    );

  /*
   * Validamos primero toda selección
   * enviada por el cliente.
   *
   * Así una opción inexistente,
   * inactiva o no disponible durante
   * booking nunca se ignora
   * silenciosamente.
   */
  for (
    const selection of
    selections
  ) {
    const serviceOption =
      serviceOptionById.get(
        selection.serviceOptionId,
      );

    if (!serviceOption) {
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
        .availableDuringBooking
    ) {
      throw new Error(
        "SERVICE_OPTION_NOT_AVAILABLE_DURING_BOOKING",
      );
    }

    assertPositiveInteger(
      selection.optionalQuantity,
      "INVALID_OPTIONAL_QUANTITY",
    );

    if (
      selection.optionalQuantity <
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
      selection.optionalQuantity >
        serviceOption
          .maxOptionalQuantity
    ) {
      throw new Error(
        "OPTIONAL_QUANTITY_ABOVE_MAXIMUM",
      );
    }

    /*
     * PERSON representa personas de
     * esta reserva.
     *
     * Si se desean agregar huéspedes
     * adicionales, debe modificarse la
     * ocupación de la reserva, no
     * falsificar la cantidad de la opción.
     */
    if (
      serviceOption.pricingBase ===
        "PERSON" &&
      selection.optionalQuantity >
        guests
    ) {
      throw new Error(
        "OPTION_PERSON_QUANTITY_EXCEEDS_GUESTS",
      );
    }

    validateOptionInterval(
      selection.startAt,
      selection.endAt,
    );
  }

  const items:
    HotelOptionQuoteItem[] =
    [];

  /*
   * Recorremos la configuración del
   * servidor, no la selección del
   * cliente.
   *
   * Esto garantiza que las opciones
   * incluidas aparezcan aunque el
   * frontend no las envíe.
   */
  for (
    const serviceOption of
    service.options
  ) {
    if (
      !serviceOption.isActive ||
      !serviceOption.option
        .isActive
    ) {
      continue;
    }

    const selection =
      selectionById.get(
        serviceOption.id,
      );

    const hasOptionalSelection =
      Boolean(selection);

    /*
     * Si no está incluida y tampoco
     * fue seleccionada, no forma parte
     * de la reserva.
     */
    if (
      !serviceOption.isIncluded &&
      !hasOptionalSelection
    ) {
      continue;
    }

    const includedQuantity =
      resolveIncludedQuantity({
        isIncluded:
          serviceOption.isIncluded,

        configuredIncludedQuantity:
          serviceOption
            .includedQuantity,

        pricingBase:
          serviceOption
            .pricingBase,

        guests,
      });

    const optionalQuantity =
      selection
        ?.optionalQuantity ??
      0;

    const interval =
      validateOptionInterval(
        selection?.startAt,
        selection?.endAt,
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

    const pricing =
      calculateOptionPrice({
        includedQuantity,

        optionalQuantity,

        unitPrice:
          serviceOption.price.toString(),

        pricingBase:
          serviceOption
            .pricingBase,

        pricingFrequency:
          serviceOption
            .pricingFrequency,

        billingUnits,
      });

    items.push({
      optionId:
        serviceOption
          .option.id,

      serviceOptionId:
        serviceOption.id,

      name:
        serviceOption
          .option.name,

      description:
        serviceOption
          .option
          .description,

      quantity:
        pricing.quantity,

      includedQuantity:
        pricing
          .includedQuantity,

      optionalQuantity:
        pricing
          .optionalQuantity,

      unitPrice:
        pricing.unitPrice,

      pricingBase:
        pricing.pricingBase,

      pricingFrequency:
        pricing
          .pricingFrequency,

      billingUnits:
        pricing.billingUnits,

      subtotal:
        pricing.subtotal,

      startAt:
        interval.startAt,

      endAt:
        interval.endAt,

      resourceTypes:
        serviceOption
          .resourceTypes
          .map(
            (
              requirement,
            ) => ({
              resourceTypeId:
                requirement
                  .resourceTypeId,

              requiredQuantity:
                requirement
                  .requiredQuantity,

              requiredResources:
                pricing.quantity *
                requirement
                  .requiredQuantity,
            }),
          ),
    });
  }

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
    businessId,

    serviceId,

    checkIn,
    checkOut,

    guests,

    items,

    subtotal,
  };
}

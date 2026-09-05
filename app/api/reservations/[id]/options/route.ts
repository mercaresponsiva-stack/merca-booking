import {
  assertProspectiveInventoryAvailable,
  evaluateProspectiveInventory,
  type ProspectiveInventoryDemand,
} from "@/lib/booking/prospective-inventory";

import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  calculateReservationFinancialState,
} from "@/lib/booking/reservation-financial-state";

import {
  isReservationActive,
} from "@/lib/booking/reservation-state";

import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

import {
  quoteHotelPostBookingOptions,
  type HotelPostBookingOptionSelection,
} from "@/lib/booking/verticals/hotel/post-booking-option-quote";

import {
  NextRequest,
  NextResponse,
} from "next/server";

import { prisma } from "@/lib/prisma";

import {
  AuthorizationError,
  requireAuthenticatedUser,
  requireBusinessAccess,
} from "@/lib/auth/business-access";

export const dynamic =
  "force-dynamic";

const RESERVATION_OPTION_WRITE_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

function privateJson(
  body: unknown,
  init: ResponseInit = {},
) {
  const headers =
    new Headers(
      init.headers,
    );

  headers.set(
    "Cache-Control",
    "private, no-store, max-age=0, must-revalidate",
  );
  headers.set(
    "Pragma",
    "no-cache",
  );
  headers.set(
    "Expires",
    "0",
  );
  headers.set(
    "X-Robots-Tag",
    "noindex, nofollow",
  );

  return NextResponse.json(
    body,
    {
      ...init,
      headers,
    },
  );
}

function isJsonObject(
  value: unknown,
): value is Record<
  string,
  unknown
> {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}

type ParsedOptionSelection = {
  reservationServiceId:
    string;

  serviceOptionId:
    string;

  optionalQuantity:
    number;

  startAt:
    Date | null;

  endAt:
    Date | null;
};

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
      "INVALID_HOTEL_RESERVATION_DATE",
    );
  }

  return `${year}-${month}-${day}`;
}

function parseOptionalDate(
  value: unknown,
  fieldName: string,
): Date | null {
  if (
    value ===
      undefined ||
    value ===
      null ||
    value ===
      ""
  ) {
    return null;
  }

  if (
    typeof value !==
    "string"
  ) {
    throw new Error(
      `INVALID_${fieldName.toUpperCase()}`,
    );
  }

  const parsed =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      parsed.getTime(),
    )
  ) {
    throw new Error(
      `INVALID_${fieldName.toUpperCase()}`,
    );
  }

  return parsed;
}

function parseSelections(
  value: unknown,
): ParsedOptionSelection[] {
  if (
    !Array.isArray(
      value,
    ) ||
    value.length <
      1
  ) {
    throw new Error(
      "OPTION_SELECTION_REQUIRED",
    );
  }

  return value.map(
    (
      raw,
      index,
    ) => {
      if (
        !raw ||
        typeof raw !==
          "object" ||
        Array.isArray(
          raw,
        )
      ) {
        throw new Error(
          `INVALID_OPTION_SELECTION_${index}`,
        );
      }

      const item =
        raw as Record<
          string,
          unknown
        >;

      const reservationServiceId =
        typeof item
          .reservationServiceId ===
          "string"
          ? item
              .reservationServiceId
              .trim()
          : "";

      const serviceOptionId =
        typeof item
          .serviceOptionId ===
          "string"
          ? item
              .serviceOptionId
              .trim()
          : "";

      const optionalQuantity =
        item.optionalQuantity;

      if (
        !reservationServiceId
      ) {
        throw new Error(
          "RESERVATION_SERVICE_ID_REQUIRED",
        );
      }

      if (
        !serviceOptionId
      ) {
        throw new Error(
          "SERVICE_OPTION_ID_REQUIRED",
        );
      }

      if (
        typeof optionalQuantity !==
          "number" ||
        !Number.isInteger(
          optionalQuantity,
        ) ||
        optionalQuantity <
          1
      ) {
        throw new Error(
          "INVALID_OPTIONAL_QUANTITY",
        );
      }

      const startAt =
        parseOptionalDate(
          item.startAt,
          "OPTION_START_AT",
        );

      const endAt =
        parseOptionalDate(
          item.endAt,
          "OPTION_END_AT",
        );

      if (
        (
          startAt ===
            null
        ) !==
        (
          endAt ===
            null
        )
      ) {
        throw new Error(
          "OPTION_INTERVAL_INCOMPLETE",
        );
      }

      if (
        startAt &&
        endAt &&
        endAt <=
          startAt
      ) {
        throw new Error(
          "INVALID_OPTION_INTERVAL",
        );
      }

      return {
        reservationServiceId,

        serviceOptionId,

        optionalQuantity,

        startAt,
        endAt,
      };
    },
  );
}

function isInputError(
  code: string,
) {
  return (
    code ===
      "OPTION_SELECTION_REQUIRED" ||
    code.startsWith(
      "INVALID_OPTION_SELECTION_",
    ) ||
    code ===
      "RESERVATION_SERVICE_ID_REQUIRED" ||
    code ===
      "SERVICE_OPTION_ID_REQUIRED" ||
    code ===
      "INVALID_OPTIONAL_QUANTITY" ||
    code ===
      "INVALID_OPTION_START_AT" ||
    code ===
      "INVALID_OPTION_END_AT" ||
    code ===
      "OPTION_INTERVAL_INCOMPLETE" ||
    code ===
      "INVALID_OPTION_INTERVAL" ||
    code ===
      "DUPLICATE_OPTION_SELECTION" ||
    code ===
      "SERVICE_OPTION_NOT_FOUND" ||
    code ===
      "SERVICE_OPTION_NOT_ACTIVE" ||
    code ===
      "SERVICE_OPTION_NOT_OPTIONAL" ||
    code ===
      "SERVICE_OPTION_NOT_AVAILABLE_AFTER_BOOKING" ||
    code ===
      "OPTIONAL_QUANTITY_BELOW_MINIMUM" ||
    code ===
      "OPTIONAL_QUANTITY_ABOVE_MAXIMUM" ||
    code ===
      "OPTION_PERSON_QUANTITY_EXCEEDS_GUESTS" ||
    code ===
      "HOTEL_OPTION_HOURLY_INTERVAL_REQUIRED" ||
    code ===
      "INVALID_OPTION_BILLING_UNITS" ||
    code ===
      "INVALID_OPTION_RESOURCE_REQUIREMENT" ||
    code ===
      "INVALID_OPTION_UNIT_PRICE" ||
    code ===
      "OPTION_PRICE_OVERFLOW"
  );
}

export async function POST(
  request: NextRequest,
  context: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    await requireAuthenticatedUser();

    const {
      id,
    } =
      await context.params;

    // ─────────────────────────────────────────────
    // 1. BODY
    // ─────────────────────────────────────────────

    let parsedBody:
      unknown;

    try {
      parsedBody =
        await request.json();
    } catch {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_JSON",

          error:
            "El cuerpo de la solicitud no es JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      !isJsonObject(
        parsedBody,
      )
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            "INVALID_RESERVATION_OPTIONS_BODY",

          error:
            "El cuerpo de la solicitud debe ser un objeto JSON válido.",
        },
        {
          status:
            400,
        },
      );
    }

    const body =
      parsedBody;

    // El changedById recibido por compatibilidad no se usa para auditoría.

    const reason =
      typeof body.reason ===
        "string" &&
      body.reason.trim()
        ? body.reason.trim()
        : null;

    let selections:
      ParsedOptionSelection[];

    try {
      selections =
        parseSelections(
          body.options,
        );
    } catch (
      error
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            error instanceof
              Error
              ? error.message
              : "INVALID_OPTION_SELECTION",

          error:
            "La selección de complementos no es válida.",
        },
        {
          status:
            400,
        },
      );
    }

    // Solo averiguamos el negocio antes de autorizar la operación.
    const reservationScope =
      await prisma.reservation.findUnique({
        where: {
          id,
        },

        select: {
          businessId:
            true,
        },
      });

    if (
      !reservationScope
    ) {
      throw new Error(
        "RESERVATION_NOT_FOUND",
      );
    }

    const access =
      await requireBusinessAccess(
        reservationScope.businessId,

        RESERVATION_OPTION_WRITE_ALLOWED_ROLES,
      );

    // ─────────────────────────────────────────────
    // 2. SERIALIZABLE TRANSACTION
    // ─────────────────────────────────────────────

    const result =
      await prisma.$transaction(
        async (
          tx,
        ) => {
          // ─────────────────────────────────────────
          // 3. RESERVATION CONTEXT
          // ─────────────────────────────────────────

          const reservation =
            await tx.reservation.findUnique({
              where: {
                id,
              },

              include: {
                business: {
                  include: {
                    businessType:
                      true,
                  },
                },

                services: {
                  select: {
                    id:
                      true,

                    serviceId:
                      true,

                    quantity:
                      true,

                    service: {
                      select: {
                        isActive:
                          true,
                      },
                    },
                  },
                },

                payments: {
                  include: {
                    refunds: {
                      select: {
                        amount:
                          true,

                        status:
                          true,
                      },
                    },
                  },

                  orderBy: {
                    createdAt:
                      "asc",
                  },
                },

                refunds: {
                  select: {
                    id:
                      true,

                    status:
                      true,
                  },
                },
              },
            });

          if (
            !reservation
          ) {
            throw new Error(
              "RESERVATION_NOT_FOUND",
            );
          }

          // ─────────────────────────────────────────
          // 4. ACTOR
          // ─────────────────────────────────────────

          const actor =
            await tx.user.findFirst({
              where: {
                id:
                  access.user.id,

                businessId:
                  reservation
                    .businessId,

                isActive:
                  true,
              },

              select: {
                id:
                  true,

                name:
                  true,

                role:
                  true,
              },
            });

          if (
            !actor
          ) {
            throw new Error(
              "OPTION_ADD_ACTOR_NOT_VALID",
            );
          }

          // ─────────────────────────────────────────
          // 5. RESERVATION STATE
          // ─────────────────────────────────────────

          if (
            !isReservationActive(
              reservation.status,
            )
          ) {
            throw new Error(
              "OPTION_ADD_RESERVATION_STATUS_NOT_ALLOWED",
            );
          }

          /*
           * No modificamos el contrato mientras
           * existe una devolución en curso.
           *
           * Así evitamos que el importe sobre el
           * que se está procesando una devolución
           * cambie a mitad de la operación.
           */
          const hasActiveRefund =
            reservation.refunds.some(
              (
                refund,
              ) =>
                refund.status ===
                  "PENDING" ||
                refund.status ===
                  "PROCESSING",
            );

          if (
            hasActiveRefund
          ) {
            throw new Error(
              "OPTION_ADD_ACTIVE_REFUND_EXISTS",
            );
          }

          if (
            !reservation
              .business
              .isActive
          ) {
            throw new Error(
              "BUSINESS_NOT_ACTIVE",
            );
          }

          // ─────────────────────────────────────────
          // 6. HOTEL V1
          // ─────────────────────────────────────────

          if (
            reservation
              .business
              .businessType
              .slug !==
            "hotel"
          ) {
            throw new Error(
              "OPTION_ADD_VERTICAL_NOT_IMPLEMENTED",
            );
          }

          if (
            reservation
              .services
              .length !==
              1 ||
            reservation
              .services[0]
              .quantity !==
              1
          ) {
            throw new Error(
              "HOTEL_OPTION_ADD_MULTI_SERVICE_NOT_IMPLEMENTED",
            );
          }

          const reservationService =
            reservation
              .services[0];

          if (
            !reservationService
              .service
              .isActive
          ) {
            throw new Error(
              "SERVICE_NOT_ACTIVE",
            );
          }

          /*
           * Cada selección debe declarar a qué
           * ReservationService pertenece.
           *
           * Hotel V1 admite únicamente uno.
           */
          for (
            const selection of
            selections
          ) {
            if (
              selection
                .reservationServiceId !==
              reservationService.id
            ) {
              throw new Error(
                "RESERVATION_SERVICE_NOT_FOUND",
              );
            }
          }

          if (
            reservation.adults ===
              null ||
            reservation.children ===
              null
          ) {
            throw new Error(
              "HOTEL_GUEST_BREAKDOWN_REQUIRED",
            );
          }

          const guests =
            reservation.adults +
            reservation.children;

          if (
            guests <
            1
          ) {
            throw new Error(
              "INVALID_GUEST_COUNT",
            );
          }

          // ─────────────────────────────────────────
          // 7. CURRENT HOTEL DATES
          // ─────────────────────────────────────────

          const checkIn =
            dateOnlyInTimezone(
              reservation.startAt,

              reservation
                .business
                .timezone,
            );

          const checkOut =
            dateOnlyInTimezone(
              reservation.endAt,

              reservation
                .business
                .timezone,
            );

          // ─────────────────────────────────────────
          // 8. SERVER-SIDE OPTION QUOTE
          // ─────────────────────────────────────────

          const quoteSelections:
            HotelPostBookingOptionSelection[] =
            selections.map(
              (
                selection,
              ) => ({
                serviceOptionId:
                  selection
                    .serviceOptionId,

                optionalQuantity:
                  selection
                    .optionalQuantity,

                startAt:
                  selection
                    .startAt,

                endAt:
                  selection
                    .endAt,
              }),
            );

          const quote =
            await quoteHotelPostBookingOptions({
              businessId:
                reservation
                  .businessId,

              serviceId:
                reservationService
                  .serviceId,

              reservationId:
                reservation.id,

              checkIn,
              checkOut,

              guests,

              selections:
                quoteSelections,

              db:
                tx,
            });

          // ─────────────────────────────────────────
          // 9. NEW PHYSICAL DEMAND ONLY
          //
          // IMPORTANTE:
          //
          // NO usamos excludeReservationId.
          //
          // La Reservation actual y sus Options
          // históricas siguen consumiendo capacidad.
          //
          // Solo preguntamos si cabe la demanda
          // adicional de esta operación.
          // ─────────────────────────────────────────

          const prospectiveDemands:
            ProspectiveInventoryDemand[] =
            [];

          for (
            const item of
            quote.items
          ) {
            for (
              const requirement of
              item.resourceTypes
            ) {
              prospectiveDemands.push({
                resourceTypeId:
                  requirement
                    .resourceTypeId,

                startAt:
                  item.startAt ??
                  reservation
                    .startAt,

                endAt:
                  item.endAt ??
                  reservation
                    .endAt,

                requiredResources:
                  requirement
                    .requiredResources,

                source:
                  `OPTION_ADD:${item.serviceOptionId}`,
              });
            }
          }

          const prospectiveInventory =
            await evaluateProspectiveInventory({
              businessId:
                reservation
                  .businessId,

              serviceId:
                reservationService
                  .serviceId,

              demands:
                prospectiveDemands,

              db:
                tx,
            });

          assertProspectiveInventoryAvailable(
            prospectiveInventory,
          );

          // ─────────────────────────────────────────
          // 10. MONEY
          //
          // Sumamos en centavos para mantener
          // exactamente la precisión contractual.
          //
          // subtotal y total se incrementan por
          // el mismo nuevo cargo, conservando
          // cualquier diferencia histórica entre
          // ambos campos.
          // ─────────────────────────────────────────

          const addedSubtotalCents =
            toCents(
              quote.subtotal,
            );

          const newSubtotal =
            fromCents(
              toCents(
                Number(
                  reservation
                    .subtotal,
                ),
              ) +
                addedSubtotalCents,
            );

          const newTotal =
            fromCents(
              toCents(
                Number(
                  reservation
                    .total,
                ),
              ) +
                addedSubtotalCents,
            );

          // ─────────────────────────────────────────
          // 11. SNAPSHOTS APPEND-ONLY
          // ─────────────────────────────────────────

          const createdOptions =
            [];

          for (
            const item of
            quote.items
          ) {
            const created =
              await tx.reservationOption.create({
                data: {
                  reservationId:
                    reservation.id,

                  reservationServiceId:
                    reservationService.id,

                  optionId:
                    item.optionId,

                  serviceOptionId:
                    item.serviceOptionId,

                  name:
                    item.name,

                  description:
                    item.description,

                  /*
                   * Post-booking:
                   *
                   * nunca recreamos aquello que
                   * ya estaba incluido originalmente.
                   */
                  quantity:
                    item.quantity,

                  includedQuantity:
                    0,

                  optionalQuantity:
                    item.optionalQuantity,

                  unitPrice:
                    item.unitPrice,

                  pricingBase:
                    item.pricingBase,

                  pricingFrequency:
                    item.pricingFrequency,

                  billingUnits:
                    item.billingUnits,

                  subtotal:
                    item.subtotal,

                  startAt:
                    item.startAt,

                  endAt:
                    item.endAt,
                },
              });

            createdOptions.push(
              created,
            );
          }

          // ─────────────────────────────────────────
          // 12. RESERVATION TOTAL
          // ─────────────────────────────────────────

          const updatedReservation =
            await tx.reservation.update({
              where: {
                id:
                  reservation.id,
              },

              data: {
                subtotal:
                  newSubtotal,

                total:
                  newTotal,
              },

              select: {
                id:
                  true,

                confirmationCode:
                  true,

                status:
                  true,

                startAt:
                  true,

                endAt:
                  true,

                subtotal:
                  true,

                total:
                  true,

                paymentOption:
                  true,

                updatedAt:
                  true,
              },
            });

          // ─────────────────────────────────────────
          // 13. AUDIT
          // ─────────────────────────────────────────

          const change =
            await tx.reservationChange.create({
              data: {
                businessId:
                  reservation
                    .businessId,

                reservationId:
                  reservation.id,

                type:
                  "OPTION_ADDED",

                changedById:
                  actor.id,

                reason,

                oldSubtotal:
                  reservation
                    .subtotal,

                newSubtotal,

                oldTotal:
                  reservation
                    .total,

                newTotal,

                oldStatus:
                  reservation
                    .status,

                newStatus:
                  reservation
                    .status,

                details: {
                  action:
                    "OPTION_ADDED",

                  addedSubtotal:
                    quote.subtotal,

                  options:
                    quote.items.map(
                      (
                        item,
                      ) => ({
                        optionId:
                          item.optionId,

                        serviceOptionId:
                          item.serviceOptionId,

                        name:
                          item.name,

                        quantity:
                          item.quantity,

                        includedQuantity:
                          0,

                        optionalQuantity:
                          item.optionalQuantity,

                        existingOptionalQuantity:
                          item.existingOptionalQuantity,

                        accumulatedOptionalQuantity:
                          item.accumulatedOptionalQuantity,

                        unitPrice:
                          item.unitPrice,

                        pricingBase:
                          item.pricingBase,

                        pricingFrequency:
                          item.pricingFrequency,

                        billingUnits:
                          item.billingUnits,

                        subtotal:
                          item.subtotal,

                        startAt:
                          item.startAt
                            ?.toISOString() ??
                          null,

                        endAt:
                          item.endAt
                            ?.toISOString() ??
                          null,
                      }),
                    ),

                  inventory: {
                    available:
                      prospectiveInventory
                        .available,

                    segments:
                      prospectiveInventory
                        .segments
                        .map(
                          (
                            segment,
                          ) => ({
                            resourceTypeId:
                              segment
                                .resourceTypeId,

                            startAt:
                              segment
                                .startAt
                                .toISOString(),

                            endAt:
                              segment
                                .endAt
                                .toISOString(),

                            prospectiveDemand:
                              segment
                                .prospectiveDemand,

                            availableBeforeDemand:
                              segment
                                .availableBeforeDemand,

                            availableAfterDemand:
                              segment
                                .availableAfterDemand,

                            sufficient:
                              segment
                                .sufficient,

                            sources:
                              segment
                                .sources,
                          }),
                        ),
                  },
                },
              },
            });

          // ─────────────────────────────────────────
          // 14. PAYMENTS REMAIN UNCHANGED
          //
          // Solo cambia el total contractual.
          //
          // Esto hace crecer el balance cuando
          // corresponda sin inventar ni modificar
          // Payment rows.
          // ─────────────────────────────────────────

          const paymentSummary =
            calculatePaymentSummary({
              total:
                newTotal,

              paymentOption:
                reservation
                  .paymentOption,

              payments:
                reservation
                  .payments,
            });

          const financialState =
            calculateReservationFinancialState({
              status:
                reservation
                  .status,

              paymentSummary,
            });

          return {
            reservation:
              updatedReservation,

            createdOptions,

            quote,

            change,

            prospectiveInventory,

            paymentSummary,

            financialState,
          };
        },

        {
          isolationLevel:
            "Serializable",
        },
      );

    // ─────────────────────────────────────────────
    // 15. RESPONSE
    // ─────────────────────────────────────────────

    return privateJson(
      {
        success:
          true,

        reservation: {
          id:
            result
              .reservation
              .id,

          confirmationCode:
            result
              .reservation
              .confirmationCode,

          status:
            result
              .reservation
              .status,

          startAt:
            result
              .reservation
              .startAt,

          endAt:
            result
              .reservation
              .endAt,

          subtotal:
            Number(
              result
                .reservation
                .subtotal,
            ),

          total:
            Number(
              result
                .reservation
                .total,
            ),

          paymentOption:
            result
              .reservation
              .paymentOption,

          updatedAt:
            result
              .reservation
              .updatedAt,
        },

        added: {
          subtotal:
            result.quote
              .subtotal,

          options:
            result
              .createdOptions
              .map(
                (
                  option,
                ) => ({
                  id:
                    option.id,

                  reservationServiceId:
                    option
                      .reservationServiceId,

                  optionId:
                    option
                      .optionId,

                  serviceOptionId:
                    option
                      .serviceOptionId,

                  name:
                    option.name,

                  description:
                    option
                      .description,

                  quantity:
                    option.quantity,

                  includedQuantity:
                    option
                      .includedQuantity,

                  optionalQuantity:
                    option
                      .optionalQuantity,

                  unitPrice:
                    Number(
                      option
                        .unitPrice,
                    ),

                  pricingBase:
                    option
                      .pricingBase,

                  pricingFrequency:
                    option
                      .pricingFrequency,

                  billingUnits:
                    Number(
                      option
                        .billingUnits,
                    ),

                  subtotal:
                    Number(
                      option
                        .subtotal,
                    ),

                  startAt:
                    option.startAt,

                  endAt:
                    option.endAt,
                }),
              ),
        },

        inventory: {
          available:
            result
              .prospectiveInventory
              .available,

          segments:
            result
              .prospectiveInventory
              .segments,

          shortages:
            result
              .prospectiveInventory
              .shortages,
        },

        change: {
          id:
            result.change.id,

          type:
            result.change.type,

          oldSubtotal:
            result
              .change
              .oldSubtotal ===
              null
              ? null
              : Number(
                  result
                    .change
                    .oldSubtotal,
                ),

          newSubtotal:
            result
              .change
              .newSubtotal ===
              null
              ? null
              : Number(
                  result
                    .change
                    .newSubtotal,
                ),

          oldTotal:
            result
              .change
              .oldTotal ===
              null
              ? null
              : Number(
                  result
                    .change
                    .oldTotal,
                ),

          newTotal:
            result
              .change
              .newTotal ===
              null
              ? null
              : Number(
                  result
                    .change
                    .newTotal,
                ),

          reason:
            result.change
              .reason,

          createdAt:
            result.change
              .createdAt,
        },

        paymentSummary:
          result
            .paymentSummary,

        financialState:
          result
            .financialState,
      },
      {
        status:
          201,
      },
    );
  } catch (
    error
  ) {
    if (
      error instanceof
        AuthorizationError
    ) {
      return privateJson(
        {
          success:
            false,

          code:
            error.code,

          error:
            error.message,
        },
        {
          status:
            error.status,
        },
      );
    }

    console.error(
      "POST reservation options error:",
      error,
    );

    const code =
      error instanceof
        Error
        ? error.message
        : "UNKNOWN_ERROR";

    // ─────────────────────────────────────────────
    // NOT FOUND
    // ─────────────────────────────────────────────

    if (
      code ===
      "RESERVATION_NOT_FOUND"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "Reserva no encontrada.",
        },
        {
          status:
            404,
        },
      );
    }

    // ─────────────────────────────────────────────
    // ACTOR
    // ─────────────────────────────────────────────

    if (
      code ===
      "OPTION_ADD_ACTOR_NOT_VALID"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "El usuario que realiza el cambio no es válido.",
        },
        {
          status:
            403,
        },
      );
    }

    // ─────────────────────────────────────────────
    // CONFLICTS
    // ─────────────────────────────────────────────

    if (
      code ===
        "OPTION_ADD_RESERVATION_STATUS_NOT_ALLOWED" ||
      code ===
        "OPTION_ADD_ACTIVE_REFUND_EXISTS" ||
      code ===
        "PROSPECTIVE_INVENTORY_NOT_AVAILABLE" ||
      code ===
        "BUSINESS_NOT_ACTIVE" ||
      code ===
        "SERVICE_NOT_ACTIVE"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            code ===
              "PROSPECTIVE_INVENTORY_NOT_AVAILABLE"
              ? "No hay inventario suficiente para agregar todos los complementos solicitados."
              : code ===
                  "OPTION_ADD_ACTIVE_REFUND_EXISTS"
                ? "La reserva tiene una devolución en proceso y no puede modificarse en este momento."
                : code ===
                    "OPTION_ADD_RESERVATION_STATUS_NOT_ALLOWED"
                  ? "El estado actual de la reserva no permite agregar complementos."
                  : "La configuración actual no permite agregar complementos a esta reserva.",
        },
        {
          status:
            409,
        },
      );
    }

    // ─────────────────────────────────────────────
    // HOTEL V1
    // ─────────────────────────────────────────────

    if (
      code ===
        "OPTION_ADD_VERTICAL_NOT_IMPLEMENTED" ||
      code ===
        "HOTEL_OPTION_ADD_MULTI_SERVICE_NOT_IMPLEMENTED"
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "Esta operación todavía no está implementada para esta configuración de reserva.",
        },
        {
          status:
            501,
        },
      );
    }

    // ─────────────────────────────────────────────
    // VALIDATION
    // ─────────────────────────────────────────────

    if (
      code ===
        "RESERVATION_SERVICE_NOT_FOUND" ||
      code ===
        "HOTEL_GUEST_BREAKDOWN_REQUIRED" ||
      code ===
        "INVALID_GUEST_COUNT" ||
      code ===
        "INVALID_HOTEL_RESERVATION_DATE" ||
      isInputError(
        code,
      )
    ) {
      return privateJson(
        {
          success:
            false,

          code,

          error:
            "No fue posible agregar los complementos porque la solicitud o configuración no es válida.",
        },
        {
          status:
            400,
        },
      );
    }

    return privateJson(
      {
        success:
          false,

        code:
          "OPTION_ADD_INTERNAL_ERROR",

        error:
          "No fue posible agregar los complementos.",
      },
      {
        status:
          500,
      },
    );
  }
}
import {
  zonedDateTimeToUtc,
} from "@/lib/booking/datetime";

import {
  fromCents,
  toCents,
} from "@/lib/booking/money";

import {
  calculatePaymentSummary,
} from "@/lib/booking/payment-summary";

import {
  assertProspectiveInventoryAvailable,
  evaluateProspectiveInventory,
  type ProspectiveInventoryDemand,
} from "@/lib/booking/prospective-inventory";

import {
  evaluateAssignedResourcesForInterval,
} from "@/lib/booking/resource-interval-check";

import {
  resolveReservationOptionActiveQuantity,
} from "@/lib/booking/reservation-option-quantity";

import {
  resolveStayExtensionFinancialImpact,
  validateReservationForStayExtension,
} from "@/lib/booking/stay-extension-policy";

import {
  calculateHotelReservationOptionExtension,
} from "@/lib/booking/verticals/hotel/reservation-option-extension";

import {
  calculateHotelPrice,
} from "@/lib/booking/verticals/hotel/pricing";

import { prisma } from "@/lib/prisma";

export type HotelStayExtensionDb =
  Pick<
    typeof prisma,
    | "reservation"
    | "business"
    | "businessType"
    | "reservationService"
    | "reservationOption"
    | "payment"
    | "refund"
    | "businessMembership"
    | "service"
    | "serviceRate"
    | "serviceResourceType"
    | "serviceOptionResourceType"
    | "serviceOption"
    | "businessOption"
    | "reservationResource"
    | "resource"
    | "resourceType"
    | "reservationChange"
    | "block"
  >;

const STAY_EXTENSION_ALLOWED_ROLES = [
  "OWNER",
  "ADMIN",
  "RECEPTIONIST",
] as const;

type ExtendCheckedInHotelStayInput = {
  reservationId:
    string;

  businessId:
    string;

  newCheckOut:
    string;

  changedById:
    string;

  reason:
    string | null;

  requestedAt:
    Date;

  db:
    HotelStayExtensionDb;
};

function dateOnlyInTimezone(
  date:
    Date,

  timezone:
    string,
) {
  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Error(
      "INVALID_STAY_EXTENSION_TIMEZONE_DATE",
    );
  }

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
      (
        part,
      ) =>
        part.type ===
        "year",
    )?.value;

  const month =
    parts.find(
      (
        part,
      ) =>
        part.type ===
        "month",
    )?.value;

  const day =
    parts.find(
      (
        part,
      ) =>
        part.type ===
        "day",
    )?.value;

  if (
    !year ||
    !month ||
    !day
  ) {
    throw new Error(
      "INVALID_STAY_EXTENSION_TIMEZONE_DATE",
    );
  }

  return `${year}-${month}-${day}`;
}

function addMoney(
  first:
    number,

  second:
    number,
) {
  const cents =
    toCents(
      first,
    ) +
    toCents(
      second,
    );

  if (
    !Number.isSafeInteger(
      cents,
    )
  ) {
    throw new Error(
      "STAY_EXTENSION_FINANCIAL_OVERFLOW",
    );
  }

  return fromCents(
    cents,
  );
}

function resolveAverageNightlyPrice(
  total:
    number,

  nights:
    number,
) {
  if (
    !Number.isInteger(
      nights,
    ) ||
    nights <=
      0
  ) {
    throw new Error(
      "INVALID_NUMBER_OF_NIGHTS",
    );
  }

  const totalCents =
    toCents(
      total,
    );

  if (
    !Number.isSafeInteger(
      totalCents,
    )
  ) {
    throw new Error(
      "STAY_EXTENSION_FINANCIAL_OVERFLOW",
    );
  }

  return fromCents(
    Math.round(
      totalCents /
      nights,
    ),
  );
}

export async function extendCheckedInHotelStay({
  reservationId,

  businessId,

  newCheckOut,

  changedById,

  reason,

  requestedAt,

  db,
}: ExtendCheckedInHotelStayInput) {
  /*
   * Las lecturas se ejecutan secuencialmente.
   *
   * Esto evita que el adaptador pg intente
   * lanzar consultas relacionales concurrentes
   * dentro de la misma transacción.
   */
  const reservation =
    await db.reservation.findFirst({
      where: {
        id:
          reservationId,

        businessId,
      },

      select: {
        id:
          true,

        businessId:
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
      },
    });

  if (!reservation) {
    throw new Error(
      "RESERVATION_NOT_FOUND",
    );
  }

  const business =
    await db.business.findFirst({
      where: {
        id:
          businessId,

        isActive:
          true,
      },

      select: {
        id:
          true,

        businessTypeId:
          true,

        timezone:
          true,

        checkOutTime:
          true,
      },
    });

  if (!business) {
    throw new Error(
      "STAY_EXTENSION_BUSINESS_NOT_FOUND",
    );
  }

  const businessType =
    await db.businessType.findFirst({
      where: {
        id:
          business.businessTypeId,

        isActive:
          true,
      },

      select: {
        slug:
          true,
      },
    });

  if (
    !businessType ||
    businessType.slug !==
      "hotel"
  ) {
    throw new Error(
      "STAY_EXTENSION_VERTICAL_NOT_IMPLEMENTED",
    );
  }

  const reservationServices =
    await db.reservationService.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        reservationId:
          true,

        serviceId:
          true,

        quantity:
          true,

        unitPrice:
          true,

        subtotal:
          true,
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  if (
    reservationServices.length !==
      1 ||
    reservationServices[0].quantity !==
      1
  ) {
    throw new Error(
      "HOTEL_STAY_EXTENSION_MULTI_SERVICE_NOT_IMPLEMENTED",
    );
  }

  const reservationService =
    reservationServices[0];

  const service =
    await db.service.findFirst({
      where: {
        id:
          reservationService.serviceId,

        businessId:
          reservation.businessId,
      },

      select: {
        id:
          true,
      },
    });

  if (!service) {
    throw new Error(
      "STAY_EXTENSION_SERVICE_NOT_FOUND",
    );
  }

  const actorMembership =
    await db.businessMembership.findFirst({
      where: {
        businessId,

        userId:
          changedById,

        isActive:
          true,

        role: {
          in: [
            ...STAY_EXTENSION_ALLOWED_ROLES,
          ],
        },

        user: {
          is: {
            isActive:
              true,
          },
        },

        business: {
          is: {
            isActive:
              true,
          },
        },
      },

      select: {
        user: {
          select: {
            id:
              true,

            name:
              true,
          },
        },
      },
    });

  if (!actorMembership) {
    throw new Error(
      "STAY_EXTENSION_ACTOR_NOT_VALID",
    );
  }

  const actor =
    actorMembership.user;

  const options =
    await db.reservationOption.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        reservationId:
          true,

        reservationServiceId:
          true,

        optionId:
          true,

        serviceOptionId:
          true,

        includedQuantity:
          true,

        optionalQuantity:
          true,

        removedOptionalQuantity:
          true,

        unitPrice:
          true,

        pricingBase:
          true,

        pricingFrequency:
          true,

        billingUnits:
          true,

        subtotal:
          true,

        startAt:
          true,

        endAt:
          true,
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  const payments =
    await db.payment.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        businessId:
          true,

        reservationId:
          true,

        amount:
          true,

        status:
          true,
      },

      orderBy: {
        createdAt:
          "asc",
      },
    });

  const refunds =
    await db.refund.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        businessId:
          true,

        reservationId:
          true,

        paymentId:
          true,

        amount:
          true,

        status:
          true,
      },
    });

  const paymentIds =
    new Set(
      payments.map(
        (
          payment,
        ) =>
          payment.id,
      ),
    );

  const financialScopeInvalid =
    payments.some(
      (
        payment,
      ) =>
        payment.businessId !==
          businessId ||
        payment.reservationId !==
          reservation.id,
    ) ||
    refunds.some(
      (
        refund,
      ) =>
        refund.businessId !==
          businessId ||
        refund.reservationId !==
          reservation.id ||
        !refund.paymentId ||
        !paymentIds.has(
          refund.paymentId,
        ),
    );

  if (financialScopeInvalid) {
    throw new Error(
      "STAY_EXTENSION_FINANCIAL_SCOPE_INVALID",
    );
  }

  const hasActiveRefund =
    refunds.some(
      (
        refund,
      ) =>
        refund.status ===
          "PENDING" ||
        refund.status ===
          "PROCESSING",
    );

  const currentCheckIn =
    dateOnlyInTimezone(
      reservation.startAt,
      business.timezone,
    );

  const currentCheckOut =
    dateOnlyInTimezone(
      reservation.endAt,
      business.timezone,
    );

  const newEndAt =
    zonedDateTimeToUtc(
      newCheckOut,
      business.checkOutTime ??
        "00:00",
      business.timezone,
    );

  const extensionValidation =
    validateReservationForStayExtension({
      status:
        reservation.status,

      currentEndAt:
        reservation.endAt,

      newEndAt,

      requestedAt,

      hasActiveRefund,
    });

  const rates =
    await db.serviceRate.findMany({
      where: {
        serviceId:
          reservationService.serviceId,

        isActive:
          true,
      },

      select: {
        startDate:
          true,

        endDate:
          true,

        weekdayPrice:
          true,

        weekendPrice:
          true,
      },

      orderBy: {
        startDate:
          "desc",
      },
    });

  const extensionPricing =
    calculateHotelPrice(
      currentCheckOut,
      newCheckOut,
      rates,
    );

  const optionExtension =
    calculateHotelReservationOptionExtension({
      currentCheckIn,
      currentCheckOut,
      newCheckOut,

      timezone:
        business.timezone,

      options:
        options.map(
          (
            option,
          ) => ({
            id:
              option.id,

            includedQuantity:
              option.includedQuantity,

            optionalQuantity:
              option.optionalQuantity,

            removedOptionalQuantity:
              option.removedOptionalQuantity,

            unitPrice:
              option.unitPrice.toString(),

            pricingBase:
              option.pricingBase,

            pricingFrequency:
              option.pricingFrequency,

            billingUnits:
              option.billingUnits.toString(),

            subtotal:
              option.subtotal.toString(),

            startAt:
              option.startAt,

            endAt:
              option.endAt,
          }),
        ),
    });

  const serviceRequirements =
    await db.serviceResourceType.findMany({
      where: {
        serviceId:
          reservationService.serviceId,
      },

      select: {
        serviceId:
          true,

        resourceTypeId:
          true,

        requiredQuantity:
          true,
      },
    });

  const serviceOptionIds = [
    ...new Set(
      options.flatMap(
        (
          option,
        ) =>
          option.serviceOptionId
            ? [
                option.serviceOptionId,
              ]
            : [],
      ),
    ),
  ];

  const optionRequirements =
    await db.serviceOptionResourceType.findMany({
      where: {
        serviceOptionId: {
          in:
            serviceOptionIds,
        },
      },

      select: {
        serviceOptionId:
          true,

        resourceTypeId:
          true,

        requiredQuantity:
          true,
      },
    });

  const assignments =
    await db.reservationResource.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
          true,

        reservationId:
          true,

        resourceId:
          true,

        reservationServiceId:
          true,

        reservationOptionId:
          true,
      },
    });

  const assignedResources =
    await db.resource.findMany({
      where: {
        id: {
          in:
            assignments.map(
              (
                assignment,
              ) =>
                assignment.resourceId,
            ),
        },

        businessId,
      },

      select: {
        id:
          true,

        businessId:
          true,

        resourceTypeId:
          true,
      },
    });

  const resourceTypeByResourceId =
    new Map(
      assignedResources.map(
        (
          resource,
        ) => [
          resource.id,
          resource.resourceTypeId,
        ],
      ),
    );

  const authorizedServiceOptions =
    serviceOptionIds.length ===
      0
      ? []
      : await db.serviceOption.findMany({
          where: {
            id: {
              in:
                serviceOptionIds,
            },

            serviceId:
              reservationService.serviceId,
          },

          select: {
            id:
              true,

            serviceId:
              true,

            optionId:
              true,
          },
        });

  const authorizedServiceOptionById =
    new Map(
      authorizedServiceOptions.map(
        (
          serviceOption,
        ) => [
          serviceOption.id,
          serviceOption,
        ],
      ),
    );

  const operationalBusinessOptionIds =
    new Set<string>(
      options.flatMap(
        (
          option,
        ) =>
          option.optionId
            ? [
                option.optionId,
              ]
            : [],
      ),
    );

  for (
    const serviceOption of
    authorizedServiceOptions
  ) {
    operationalBusinessOptionIds.add(
      serviceOption.optionId,
    );
  }

  const authorizedBusinessOptions =
    operationalBusinessOptionIds.size ===
      0
      ? []
      : await db.businessOption.findMany({
          where: {
            id: {
              in: [
                ...operationalBusinessOptionIds,
              ],
            },

            businessId,
          },

          select: {
            id:
              true,
          },
        });

  const authorizedBusinessOptionIds =
    new Set(
      authorizedBusinessOptions.map(
        (
          businessOption,
        ) =>
          businessOption.id,
      ),
    );

  const operationalResourceTypeIds =
    new Set<string>();

  for (
    const requirement of
    serviceRequirements
  ) {
    operationalResourceTypeIds.add(
      requirement.resourceTypeId,
    );
  }

  for (
    const requirement of
    optionRequirements
  ) {
    operationalResourceTypeIds.add(
      requirement.resourceTypeId,
    );
  }

  for (
    const resource of
    assignedResources
  ) {
    if (resource.resourceTypeId) {
      operationalResourceTypeIds.add(
        resource.resourceTypeId,
      );
    }
  }

  const authorizedResourceTypes =
    operationalResourceTypeIds.size ===
      0
      ? []
      : await db.resourceType.findMany({
          where: {
            id: {
              in: [
                ...operationalResourceTypeIds,
              ],
            },

            businessId,
          },

          select: {
            id:
              true,
          },
        });

  const optionById =
    new Map(
      options.map(
        (
          option,
        ) => [
          option.id,
          option,
        ],
      ),
    );

  const serviceResourceTypeIds =
    new Set(
      serviceRequirements.map(
        (
          requirement,
        ) =>
          requirement.resourceTypeId,
      ),
    );

  let operationalScopeInvalid =
    reservationService.reservationId !==
      reservation.id ||
    authorizedServiceOptions.length !==
      serviceOptionIds.length ||
    authorizedBusinessOptions.length !==
      operationalBusinessOptionIds.size ||
    authorizedResourceTypes.length !==
      operationalResourceTypeIds.size ||
    assignedResources.length !==
      new Set(
        assignments.map(
          (
            assignment,
          ) =>
            assignment.resourceId,
        ),
      ).size;

  for (
    const requirement of
    serviceRequirements
  ) {
    if (
      requirement.serviceId !==
        reservationService.serviceId ||
      !Number.isInteger(
        requirement.requiredQuantity,
      ) ||
      requirement.requiredQuantity <
        1 ||
      !Number.isSafeInteger(
        requirement.requiredQuantity *
          reservationService.quantity,
      )
    ) {
      operationalScopeInvalid =
        true;
    }
  }

  for (
    const requirement of
    optionRequirements
  ) {
    if (
      !authorizedServiceOptionById.has(
        requirement.serviceOptionId,
      ) ||
      !Number.isInteger(
        requirement.requiredQuantity,
      ) ||
      requirement.requiredQuantity <
        1
    ) {
      operationalScopeInvalid =
        true;
    }
  }

  for (
    const option of
    options
  ) {
    const serviceOption =
      option.serviceOptionId
        ? authorizedServiceOptionById.get(
            option.serviceOptionId,
          )
        : null;

    if (
      option.reservationId !==
        reservation.id ||
      (
        option.reservationServiceId !==
          null &&
        option.reservationServiceId !==
          reservationService.id
      ) ||
      (
        option.optionId !==
          null &&
        !authorizedBusinessOptionIds.has(
          option.optionId,
        )
      ) ||
      (
        option.serviceOptionId !==
          null &&
        !serviceOption
      ) ||
      (
        serviceOption &&
        option.optionId !==
          null &&
        serviceOption.optionId !==
          option.optionId
      )
    ) {
      operationalScopeInvalid =
        true;
    }
  }

  for (
    const assignment of
    assignments
  ) {
    const resourceTypeId =
      resourceTypeByResourceId.get(
        assignment.resourceId,
      );

    const hasService =
      assignment.reservationServiceId !==
      null;

    const hasOption =
      assignment.reservationOptionId !==
      null;

    const reservationOption =
      assignment.reservationOptionId
        ? optionById.get(
            assignment.reservationOptionId,
          )
        : null;

    const optionAllowsResourceType =
      reservationOption?.serviceOptionId &&
      resourceTypeId
        ? optionRequirements.some(
            (
              requirement,
            ) =>
              requirement.serviceOptionId ===
                reservationOption.serviceOptionId &&
              requirement.resourceTypeId ===
                resourceTypeId,
          )
        : false;

    if (
      assignment.reservationId !==
        reservation.id ||
      !resourceTypeId ||
      hasService ===
        hasOption ||
      (
        hasService &&
        (
          assignment.reservationServiceId !==
            reservationService.id ||
          !serviceResourceTypeIds.has(
            resourceTypeId,
          )
        )
      ) ||
      (
        hasOption &&
        (
          !reservationOption ||
          !optionAllowsResourceType
        )
      )
    ) {
      operationalScopeInvalid =
        true;
    }
  }

  if (operationalScopeInvalid) {
    throw new Error(
      "STAY_EXTENSION_OPERATIONAL_SCOPE_INVALID",
    );
  }

  /*
   * Una estancia ya iniciada debe conservar
   * asignaciones físicas completas.
   */
  for (
    const requirement of
    serviceRequirements
  ) {
    const requiredResources =
      Math.max(
        requirement.requiredQuantity,
        1,
      ) *
      reservationService.quantity;

    const assignedCount =
      assignments.filter(
        (
          assignment,
        ) =>
          assignment.reservationOptionId ===
            null &&
          assignment.reservationServiceId ===
            reservationService.id &&
          resourceTypeByResourceId.get(
            assignment.resourceId,
          ) ===
            requirement.resourceTypeId,
      ).length;

    if (
      assignedCount <
      requiredResources
    ) {
      throw new Error(
        "STAY_EXTENSION_REQUIRED_RESOURCES_NOT_ASSIGNED",
      );
    }
  }

  const prospectiveDemands:
    ProspectiveInventoryDemand[] =
    [];

  for (
    const requirement of
    serviceRequirements
  ) {
    prospectiveDemands.push({
      resourceTypeId:
        requirement.resourceTypeId,

      startAt:
        reservation.endAt,

      endAt:
        newEndAt,

      requiredResources:
        Math.max(
          requirement.requiredQuantity,
          1,
        ) *
        reservationService.quantity,

      source:
        `SERVICE:${reservationService.id}`,
    });
  }

  const inheritedActiveOptionIds =
    new Set<string>();

  for (
    const option of
    options
  ) {
    const hasOwnStart =
      option.startAt !==
      null;

    const hasOwnEnd =
      option.endAt !==
      null;

    if (
      hasOwnStart !==
      hasOwnEnd
    ) {
      throw new Error(
        "RESERVATION_OPTION_INTERVAL_INCOMPLETE",
      );
    }

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
     * Los intervalos propios permanecen
     * intactos y no forman parte del tramo
     * que se está agregando.
     */
    if (
      hasOwnStart ||
      activeQuantity.isFullyRemoved
    ) {
      continue;
    }

    inheritedActiveOptionIds.add(
      option.id,
    );

    const requirements =
      option.serviceOptionId
        ? optionRequirements.filter(
            (
              requirement,
            ) =>
              requirement.serviceOptionId ===
              option.serviceOptionId,
          )
        : [];

    for (
      const requirement of
      requirements
    ) {
      const requiredResources =
        activeQuantity.activeQuantity *
        requirement.requiredQuantity;

      if (
        !Number.isSafeInteger(
          requiredResources,
        )
      ) {
        throw new Error(
          "STAY_EXTENSION_OPERATIONAL_SCOPE_INVALID",
        );
      }

      const assignedCount =
        assignments.filter(
          (
            assignment,
          ) =>
            assignment.reservationOptionId ===
              option.id &&
            resourceTypeByResourceId.get(
              assignment.resourceId,
            ) ===
              requirement.resourceTypeId,
        ).length;

      if (
        assignedCount <
        requiredResources
      ) {
        throw new Error(
          "STAY_EXTENSION_REQUIRED_RESOURCES_NOT_ASSIGNED",
        );
      }

      prospectiveDemands.push({
        resourceTypeId:
          requirement.resourceTypeId,

        startAt:
          reservation.endAt,

        endAt:
          newEndAt,

        requiredResources,

        source:
          `OPTION:${option.id}`,
      });
    }
  }

  /*
   * La reserva persistida termina exactamente
   * donde comienza este tramo adicional.
   *
   * Por eso no la excluimos: cualquier opción
   * con intervalo propio que todavía continúe
   * debe seguir contando como demanda existente.
   */
  const prospectiveInventory =
    await evaluateProspectiveInventory({
      businessId:
        reservation.businessId,

      serviceId:
        reservationService.serviceId,

      demands:
        prospectiveDemands,

      db,
    });

  assertProspectiveInventoryAvailable(
    prospectiveInventory,
  );

  const resourceEvaluation =
    await evaluateAssignedResourcesForInterval({
      businessId:
        reservation.businessId,

      reservationId:
        reservation.id,

      startAt:
        reservation.endAt,

      endAt:
        newEndAt,

      db,
    });

  const extendedAssignmentIds =
    new Set(
      assignments.flatMap(
        (
          assignment,
        ) => {
          if (
            assignment.reservationOptionId !==
            null
          ) {
            return inheritedActiveOptionIds.has(
              assignment.reservationOptionId,
            )
              ? [
                  assignment.id,
                ]
              : [];
          }

          return assignment.reservationServiceId ===
            reservationService.id
            ? [
                assignment.id,
              ]
            : [];
        },
      ),
    );

  const unavailableAssignments =
    resourceEvaluation.release.filter(
      (
        assignment,
      ) =>
        extendedAssignmentIds.has(
          assignment.assignmentId,
        ),
    );

  if (
    unavailableAssignments.length >
    0
  ) {
    console.warn(
      "STAY EXTENSION assigned resource integrity violation:",
      {
        reservationId:
          reservation.id,

        unavailableAssignments,
      },
    );

    throw new Error(
      "ASSIGNED_RESOURCES_UNAVAILABLE_FOR_STAY_EXTENSION",
    );
  }

  const keptAssignments =
    resourceEvaluation.keep.filter(
      (
        assignment,
      ) =>
        extendedAssignmentIds.has(
          assignment.assignmentId,
        ),
    );

  const paymentsForSummary =
    payments.map(
      (
        payment,
      ) => ({
        amount:
          payment.amount,

        status:
          payment.status,

        refunds:
          refunds
            .filter(
              (
                refund,
              ) =>
                refund.paymentId ===
                payment.id,
            )
            .map(
              (
                refund,
              ) => ({
                amount:
                  refund.amount,

                status:
                  refund.status,
              }),
            ),
      }),
    );

  const currentPaymentSummary =
    calculatePaymentSummary({
      total:
        Number(
          reservation.total,
        ),

      paymentOption:
        reservation.paymentOption,

      payments:
        paymentsForSummary,
    });

  const financialImpact =
    resolveStayExtensionFinancialImpact({
      currentSubtotal:
        Number(
          reservation.subtotal,
        ),

      currentTotal:
        Number(
          reservation.total,
        ),

      additionalServiceSubtotal:
        extensionPricing.total,

      additionalOptionSubtotal:
        optionExtension.additionalSubtotal,

      netPaid:
        currentPaymentSummary.netPaid,
    });

  const newServiceSubtotal =
    addMoney(
      Number(
        reservationService.subtotal,
      ),

      financialImpact.additionalServiceSubtotal,
    );

  const newServiceUnitPrice =
    resolveAverageNightlyPrice(
      newServiceSubtotal,
      optionExtension.newNights,
    );

  const reservationOptionIds =
    new Set(
      options.map(
        (
          option,
        ) =>
          option.id,
      ),
    );

  const optionItemIds =
    new Set(
      optionExtension.items.map(
        (
          optionItem,
        ) =>
          optionItem.id,
      ),
    );

  if (
    optionItemIds.size !==
      optionExtension.items.length ||
    optionExtension.items.some(
      (
        optionItem,
      ) =>
        !reservationOptionIds.has(
          optionItem.id,
        ),
    )
  ) {
    throw new Error(
      "STAY_EXTENSION_OPERATIONAL_SCOPE_INVALID",
    );
  }

  const change =
    await db.reservationChange.create({
      data: {
        businessId:
          reservation.businessId,

        reservationId:
          reservation.id,

        type:
          "STAY_EXTENSION",

        changedById:
          actor.id,

        reason,

        oldStartAt:
          reservation.startAt,

        newStartAt:
          reservation.startAt,

        oldEndAt:
          reservation.endAt,

        newEndAt,

        oldSubtotal:
          reservation.subtotal,

        newSubtotal:
          financialImpact.newSubtotal,

        oldTotal:
          reservation.total,

        newTotal:
          financialImpact.newTotal,

        oldStatus:
          reservation.status,

        newStatus:
          extensionValidation.nextStatus,

        details: {
          vertical:
            "hotel",

          operation:
            "stay_extension",

          requestedAt,

          currentCheckIn,
          currentCheckOut,
          newCheckOut,

          nights: {
            previous:
              optionExtension.previousNights,

            additional:
              optionExtension.additionalNights,

            total:
              optionExtension.newNights,
          },

          pricing: {
            addedNightlyPrices:
              extensionPricing.nightlyPrices,

            additionalServiceSubtotal:
              financialImpact.additionalServiceSubtotal,

            additionalOptionSubtotal:
              financialImpact.additionalOptionSubtotal,

            additionalCharge:
              financialImpact.additionalCharge,

            newServiceSubtotal,

            optionChanges:
              optionExtension.items,

            newSubtotal:
              financialImpact.newSubtotal,

            newTotal:
              financialImpact.newTotal,
          },

          financial: {
            netPaid:
              financialImpact.netPaid,

            balance:
              financialImpact.balance,

            credit:
              financialImpact.credit,
          },

          inventory: {
            available:
              prospectiveInventory.available,

            segments:
              prospectiveInventory.segments.map(
                (
                  segment,
                ) => ({
                  resourceTypeId:
                    segment.resourceTypeId,

                  startAt:
                    segment.startAt,

                  endAt:
                    segment.endAt,

                  prospectiveDemand:
                    segment.prospectiveDemand,

                  availableBeforeDemand:
                    segment.availableBeforeDemand,

                  availableAfterDemand:
                    segment.availableAfterDemand,

                  sufficient:
                    segment.sufficient,

                  sources:
                    segment.sources,
                }),
              ),
          },

          resources: {
            kept:
              keptAssignments,
          },
        },
      },
    });

  await db.reservation.update({
    where: {
      id:
        reservation.id,

      businessId,

      status:
        reservation.status,

      endAt:
        reservation.endAt,
    },

    data: {
      endAt:
        newEndAt,

      subtotal:
        financialImpact.newSubtotal,

      total:
        financialImpact.newTotal,
    },
  });

  await db.reservationService.update({
    where: {
      id:
        reservationService.id,

      reservationId:
        reservation.id,

      serviceId:
        reservationService.serviceId,
    },

    data: {
      unitPrice:
        newServiceUnitPrice,

      subtotal:
        newServiceSubtotal,
    },
  });

  for (
    const optionItem of
    optionExtension.items
  ) {
    await db.reservationOption.update({
      where: {
        id:
          optionItem.id,

        reservationId:
          reservation.id,
      },

      data: {
        billingUnits:
          optionItem.newBillingUnits,

        subtotal:
          optionItem.newSubtotal,
      },
    });
  }

  const paymentSummary =
    calculatePaymentSummary({
      total:
        financialImpact.newTotal,

      paymentOption:
        reservation.paymentOption,

      payments:
        paymentsForSummary,
    });

  return {
    reservation: {
      id:
        reservation.id,

      confirmationCode:
        reservation.confirmationCode,

      status:
        extensionValidation.nextStatus,

      startAt:
        reservation.startAt,

      endAt:
        newEndAt,

      subtotal:
        financialImpact.newSubtotal,

      total:
        financialImpact.newTotal,

      paymentOption:
        reservation.paymentOption,
    },

    change,

    pricing: {
      previousNights:
        optionExtension.previousNights,

      additionalNights:
        optionExtension.additionalNights,

      nights:
        optionExtension.newNights,

      addedNightlyPrices:
        extensionPricing.nightlyPrices,

      additionalServiceSubtotal:
        financialImpact.additionalServiceSubtotal,

      additionalOptionSubtotal:
        financialImpact.additionalOptionSubtotal,

      additionalCharge:
        financialImpact.additionalCharge,

      newServiceSubtotal,

      newOptionSubtotal:
        optionExtension.newSubtotal,

      newTotal:
        financialImpact.newTotal,
    },

    resources: {
      kept:
        keptAssignments,

      unavailable:
        unavailableAssignments,
    },

    inventory: {
      available:
        prospectiveInventory.available,

      segments:
        prospectiveInventory.segments,

      shortages:
        prospectiveInventory.shortages,
    },

    financialImpact,

    paymentSummary,
  };
}
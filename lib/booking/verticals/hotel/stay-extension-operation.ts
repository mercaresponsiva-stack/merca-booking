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
    | "user"
    | "service"
    | "serviceRate"
    | "serviceResourceType"
    | "serviceOptionResourceType"
    | "reservationResource"
    | "resource"
    | "reservationChange"
    | "block"
  >;

type ExtendCheckedInHotelStayInput = {
  reservationId:
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
    await db.reservation.findUnique({
      where: {
        id:
          reservationId,
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
    await db.business.findUnique({
      where: {
        id:
          reservation.businessId,
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
    await db.businessType.findUnique({
      where: {
        id:
          business.businessTypeId,
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

  const actor =
    await db.user.findFirst({
      where: {
        id:
          changedById,

        businessId:
          reservation.businessId,

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

  if (!actor) {
    throw new Error(
      "STAY_EXTENSION_ACTOR_NOT_VALID",
    );
  }

  const options =
    await db.reservationOption.findMany({
      where: {
        reservationId:
          reservation.id,
      },

      select: {
        id:
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
        paymentId:
          true,

        amount:
          true,

        status:
          true,
      },
    });

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
      },

      select: {
        id:
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
        Math.max(
          requirement.requiredQuantity,
          1,
        );

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